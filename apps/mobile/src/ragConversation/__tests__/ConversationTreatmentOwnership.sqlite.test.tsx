import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { t } from '../../i18n';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../../aiFeatures/integration/conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../../aiFeatures/integration/conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { listSavedTreatment } from '../../treatmentContext/treatmentSavedLibrary';
import { savedManualHistorySource } from '../../aiFeatures/integration/manualHistoryEvidence';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import type { EvidenceReference } from '@orot/agent-runtime';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const openDatabase = jest.mocked(openLocalAgentMemoryDatabase);

async function press(name: string) {
  await fireEvent.press(await screen.findByRole('button', { name }));
}

async function enterSafety() {
  await press(t('treatmentSafety.adult'));
  await fireEvent.changeText(
    screen.getByLabelText(t('treatmentSafety.systolic')),
    '120',
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('treatmentSafety.diastolic')),
    '80',
  );
  await press(t('treatmentSafety.none'));
}

async function reopenSaved() {
  await press(t('treatmentSafety.open'));
  await press(t('treatmentSafety.saved'));
  await fireEvent.press(
    await screen.findByRole('button', { name: /저장한 설명 열기/ }),
  );
  await enterSafety();
  await press(t('treatmentSafety.confirm'));
  await screen.findByText(t('treatmentSafety.reportedCondition'));
}

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
    const onOpenSource = jest.fn<void, [EvidenceReference]>();
    let sessions!: ConversationSessions;
    const registry = new LocalEvidenceReferenceRegistry();
    let store = createConversationArtifactStorage(database);
    const mount = () => {
      const data = {
        ...localData([]).data,
        manualHistory: history,
        openConversationArtifactStorage: async () => store,
        conversationArtifactDiscovery: async (
          sourceRegistry: LocalEvidenceReferenceRegistry,
        ) =>
          createConversationArtifactDiscovery({
            database,
            storage: store,
            registry: sourceRegistry,
            data,
          }),
      };
      function Screen() {
        sessions = useConversationSessions();
        return (
          <ConversationScreen
            onSend={onSend}
            onBack={jest.fn()}
            onOpenSource={onOpenSource}
          />
        );
      }
      return render(
        <ConversationSessionsProvider
          options={createConversationSessionOptions({
            loadLocalData: async () => data,
            registry,
          })}
        >
          <Screen />
        </ConversationSessionsProvider>,
      );
    };
    const view = await mount();
    await press(t('treatmentSafety.open'));
    await press(t('treatmentSafety.chooseSource'));
    await fireEvent.press(
      await screen.findByRole('button', { name: /합성 진단 기록/ }),
    );
    await enterSafety();
    await press(t('treatmentSafety.saveAndConfirm'));
    await screen.findByText(t('treatmentSafety.reportedCondition'));
    expect(screen.getByText(t('treatmentSafety.generalOptions'))).toBeTruthy();
    expect(screen.getByText(t('treatmentSafety.benefitsRisks'))).toBeTruthy();
    expect(screen.getByText(t('treatmentSafety.sourceLimits'))).toBeTruthy();
    expect(screen.queryByText('검증되지 않은 원문')).toBeNull();
    const lease = sessions.treatment.lease(sessions.getSnapshot().activeId)!;
    const [saved] = await listSavedTreatment(database, lease);
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
    const [owner] = (await store.listSessions()).items;
    expect(owner?.id).toBe(lease.id);
    await store.createSession(
      'other-conversation',
      await store.currentGeneration(),
    );
    await press(t('treatmentSafety.openSource', { index: 1 }));
    const [reference] = onOpenSource.mock.calls[0]!;
    expect(
      await registry.readSource(reference, new AbortController().signal),
    ).toMatchObject({
      status: 'available',
      document: { sourceKind: 'manual_history', evidence },
    });
    await view.unmount();
    connection.close();
    connection = openSqliteTestDatabase(path);
    database = connection.database;
    history = createManualHistoryRepository(database);
    store = createConversationArtifactStorage(database);
    openDatabase.mockResolvedValue(database);
    await mount();
    await act(async () => {
      await sessions.attachExisting('other-conversation', 0, owner!.updatedAt);
    });
    await press(t('treatmentSafety.open'));
    await press(t('treatmentSafety.saved'));
    await screen.findByText(t('treatmentSafety.noSaved'));
    await press(t('treatmentSafety.close'));
    await act(async () => {
      await sessions.attachExisting(
        owner!.id,
        owner!.version,
        owner!.updatedAt,
      );
    });
    await reopenSaved();
    await press(t('treatmentSafety.openSource', { index: 1 }));
    const reopenedReference = onOpenSource.mock.calls[1]![0];
    expect(
      await registry.readSource(
        reopenedReference,
        new AbortController().signal,
      ),
    ).toMatchObject({
      status: 'available',
      document: { sourceKind: 'manual_history', evidence },
    });
    await reopenSaved();
    await press(t('treatmentSafety.followUp'));
    await enterSafety();
    await press(t('treatmentSafety.saveAndConfirm'));
    await screen.findByText(t('treatmentSafety.recordQuestion'));
    const [followUp] = (await listSavedTreatment(database, lease)).filter(
      item => item.id !== saved!.id,
    );
    expect((await store.read(followUp!.id))?.treatmentContext).toEqual(
      artifact?.treatmentContext,
    );
    expect((await store.read(followUp!.id))?.citations).toEqual(
      artifact?.citations,
    );
    await press(t('treatmentSafety.deleteSaved'));
    await screen.findByRole('button', { name: /저장한 설명 열기/ });
    expect(await store.read(followUp!.id)).toBeNull();
    expect(await store.read(saved!.id)).not.toBeNull();
    await press(t('treatmentSafety.close'));
    await press(t('treatmentSafety.open'));
    await press(t('treatmentSafety.saved'));
    await fireEvent.press(
      (await screen.findAllByRole('button', { name: /저장한 설명 열기/ }))[0]!,
    );
    await history.delete(entry.id);
    expect(
      await registry.readSource(
        reopenedReference,
        new AbortController().signal,
      ),
    ).toMatchObject({ status: 'changed' });
    await enterSafety();
    await press(t('treatmentSafety.confirm'));
    await screen.findByText(t('treatmentSafety.withheld'));
    expect(await store.read(saved!.id)).toBeNull();
    expect(await store.read(followUp!.id)).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
