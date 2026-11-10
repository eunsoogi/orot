import { fireEvent, render, screen } from '@testing-library/react-native';
import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { t } from '../../i18n';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { listSavedTreatment } from '../../treatmentContext/treatmentSavedLibrary';
import { savedManualHistorySource } from '../../aiFeatures/integration/manualHistoryEvidence';
import { ConversationScreen } from '../ConversationScreen';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const openDatabase = jest.mocked(openLocalAgentMemoryDatabase);
beforeEach(() => openDatabase.mockReset());

async function press(
  name: Exclude<keyof typeof treatmentSafetyKo, 'treatmentSafety.sourceCount'>,
) {
  await fireEvent.press(screen.getByRole('button', { name: t(name) }));
}

async function openTreatment() {
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.open') }),
  );
}

async function enterReading(systolic: string, diastolic: string) {
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.adult') }),
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('treatmentSafety.systolic')),
    systolic,
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('treatmentSafety.diastolic')),
    diastolic,
  );
}

test('explicit local safety flow preserves the draft and prioritizes policy without opening storage', async () => {
  const onSend = jest.fn();
  await render(
    <ConversationScreen
      onSend={onSend}
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
    />,
  );
  const draft = screen.getByTestId('rag-conversation-input');
  await fireEvent.changeText(draft, '기존 초안');
  expect(screen.queryByText(t('treatmentSafety.confirmation'))).toBeNull();
  await openTreatment();
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.skip') }),
  );
  await screen.findByText(t('treatmentSafety.inputRequired'));
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.close') }),
  );

  await openTreatment();
  expect(screen.getByLabelText(t('treatmentSafety.systolic')).props.value).toBe(
    '',
  );
  await enterReading('190', '120');
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.chestPain') }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.skip') }),
  );
  await screen.findByText(t('treatmentSafety.emergency'));
  expect(screen.queryByText(t('treatmentSafety.generalOptions'))).toBeNull();
  expect(openDatabase).not.toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.close') }),
  );
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '기존 초안',
  );
  await openTreatment();
  await enterReading('190', '120');
  await press('treatmentSafety.none');
  await press('treatmentSafety.confirm');
  await screen.findByText(t('treatmentSafety.repeatReading'));
  expect(openDatabase).not.toHaveBeenCalled();
});

test('saves selected record provenance, reopens and follows up locally, then withholds after source deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'treatment-ui-'));
  const path = join(directory, 'treatment.db');
  let connection = openSqliteTestDatabase(path);
  try {
    let { database } = connection;
    await runMigrations(database);
    let history = createManualHistoryRepository(database);
    const entry = await history.create({
      kind: 'diagnosis_history',
      title: '합성 진단 기록',
      details: '검증되지 않은 원문',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = (await history.getEvidence(entry.id))!;
    openDatabase.mockResolvedValue(database);
    const onSend = jest.fn();
    await render(
      <ConversationScreen
        onSend={onSend}
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
      />,
    );
    await openTreatment();
    await press('treatmentSafety.chooseSource');
    await fireEvent.press(
      await screen.findByRole('button', { name: /합성 진단 기록/ }),
    );
    await enterReading('120', '80');
    await press('treatmentSafety.none');
    await press('treatmentSafety.saveAndConfirm');
    await screen.findByText(t('treatmentSafety.reportedCondition'));
    expect(
      screen.getByText(t('treatmentSafety.sourceCount', { count: 1 })),
    ).toBeTruthy();
    expect(screen.getByText(t('treatmentSafety.sourceLimits'))).toBeTruthy();
    expect(screen.queryByText('검증되지 않은 원문')).toBeNull();
    const [saved] = await listSavedTreatment(database);
    let store = createConversationArtifactStorage(database);
    const artifact = await store.read(saved!.id);
    expect(artifact?.treatmentContext?.conditions).toEqual([
      expect.objectContaining({
        status: 'user_reported',
        record: savedManualHistorySource(evidence),
      }),
    ]);
    expect(artifact?.citations).toEqual([
      expect.objectContaining({
        sourceId: entry.id,
        sourceRevision: savedManualHistorySource(evidence).revision,
      }),
    ]);
    expect(JSON.stringify(artifact)).not.toMatch(
      /systolicMmHg|diastolicMmHg|symptomAssessment|adult_not_pregnant/,
    );
    expect((await store.listSessions()).items).toEqual([]);
    await press('treatmentSafety.close');
    connection.close();
    connection = openSqliteTestDatabase(path);
    database = connection.database;
    history = createManualHistoryRepository(database);
    store = createConversationArtifactStorage(database);
    openDatabase.mockResolvedValue(database);
    await openTreatment();
    await press('treatmentSafety.saved');
    await fireEvent.press(
      await screen.findByRole('button', { name: /저장한 설명 열기/ }),
    );
    await enterReading('120', '80');
    await press('treatmentSafety.none');
    await press('treatmentSafety.confirm');
    await screen.findByText(t('treatmentSafety.reportedCondition'));
    await press('treatmentSafety.followUp');
    await enterReading('120', '80');
    await press('treatmentSafety.none');
    await press('treatmentSafety.saveAndConfirm');
    await screen.findByText(t('treatmentSafety.recordQuestion'));
    const [followUp] = (await listSavedTreatment(database)).filter(
      item => item.id !== saved!.id,
    );
    expect((await store.read(followUp!.id))?.treatmentContext).toEqual(
      artifact?.treatmentContext,
    );
    expect((await store.read(followUp!.id))?.citations).toEqual(
      artifact?.citations,
    );
    await press('treatmentSafety.deleteSaved');
    await screen.findByRole('button', { name: /저장한 설명 열기/ });
    expect(await store.read(followUp!.id)).toBeNull();
    expect(await store.read(saved!.id)).not.toBeNull();
    await press('treatmentSafety.close');
    await openTreatment();
    await press('treatmentSafety.saved');
    await fireEvent.press(
      (await screen.findAllByRole('button', { name: /저장한 설명 열기/ }))[0]!,
    );
    await history.delete(entry.id);
    await enterReading('120', '80');
    await press('treatmentSafety.none');
    await press('treatmentSafety.confirm');
    await screen.findByText(t('treatmentSafety.withheld'));
    expect(await store.read(saved!.id)).toBeNull();
    expect(await store.read(followUp!.id)).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('complete current input reaches the verified local producer without entering conversation history', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    openDatabase.mockResolvedValueOnce(connection.database);
    const onSend = jest.fn();
    await render(
      <ConversationScreen
        onSend={onSend}
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
      />,
    );
    await openTreatment();
    await enterReading('120', '80');
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.none') }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.confirm') }),
    );
    await screen.findByText(t('treatmentSafety.generalOptions'));
    expect(screen.queryByLabelText(t('treatmentSafety.systolic'))).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.close') }),
    );
    expect(screen.queryByText(t('treatmentSafety.generalOptions'))).toBeNull();
  } finally {
    connection.close();
  }
});
