import { fireEvent, render, screen } from '@testing-library/react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { t } from '../../i18n';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { ConversationScreen } from '../ConversationScreen';
import { Linking } from 'react-native';
import { ConversationSessionsProvider } from '../ConversationSessionsContext';
import { createTreatmentSourceResolver } from '../../aiFeatures/integration/resolveTreatmentSource';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const openDatabase = jest.mocked(openLocalAgentMemoryDatabase);
beforeEach(() => openDatabase.mockReset());

async function press(
  name: Exclude<
    keyof typeof treatmentSafetyKo,
    'treatmentSafety.openSource' | 'treatmentSafety.openPublicSource'
  >,
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
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      '고혈압 치료가 궁금해요.',
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
    expect(
      screen.queryByText(t('treatmentSafety.hypertensionOverview')),
    ).toBeNull();
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

test.each([
  [
    'WHO · Hypertension',
    'https://www.who.int/news-room/fact-sheets/detail/hypertension',
  ],
  [
    'WHO · Guideline for the pharmacological treatment of hypertension in adults',
    'https://www.who.int/publications/i/item/9789240033986',
  ],
  [
    'AHA · Home Blood Pressure Monitoring',
    'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home',
  ],
])(
  'opens %s only after selecting the public topic, passing policy, and tapping its original source',
  async (title, url) => {
    const connection = openSqliteTestDatabase(':memory:');
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    try {
      await runMigrations(connection.database);
      openDatabase.mockResolvedValue(connection.database);
      const onSend = jest.fn();
      const onOpenSource = jest.fn();
      await render(
        <ConversationSessionsProvider
          options={{
            resolveTreatmentSource: createTreatmentSourceResolver({
              registry: new LocalEvidenceReferenceRegistry(),
              loadLocalData: async () => localData([]).data,
            }),
          }}
        >
          <ConversationScreen
            onSend={onSend}
            onBack={jest.fn()}
            onOpenSource={onOpenSource}
          />
        </ConversationSessionsProvider>,
      );
      await openTreatment();
      await press('treatmentSafety.chooseHypertension');
      await enterReading('190', '120');
      await press('treatmentSafety.chestPain');
      await press('treatmentSafety.confirm');
      await screen.findByText(t('treatmentSafety.emergency'));
      expect(
        screen.queryByText(t('treatmentSafety.hypertensionOverview')),
      ).toBeNull();
      expect(openDatabase).not.toHaveBeenCalled();
      await press('treatmentSafety.close');
      await openTreatment();
      await press('treatmentSafety.chooseHypertension');
      expect(
        screen.queryByText(t('treatmentSafety.hypertensionOverview')),
      ).toBeNull();
      await enterReading('120', '80');
      await press('treatmentSafety.none');
      await press('treatmentSafety.confirm');
      await screen.findByText(t('treatmentSafety.hypertensionOverview'));
      expect(screen.queryByText(t('treatmentSafety.sourceLimits'))).toBeNull();
      expect(openUrl).not.toHaveBeenCalled();
      await fireEvent.press(
        screen.getByRole('button', {
          name: t('treatmentSafety.openPublicSource', { title }),
        }),
      );
      expect(openUrl).toHaveBeenCalledTimes(1);
      expect(openUrl).toHaveBeenCalledWith(url);
      expect(onOpenSource).not.toHaveBeenCalled();
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      openUrl.mockRestore();
      connection.close();
    }
  },
);
