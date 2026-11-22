import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import App from '../App';
import {
  apple,
  localData,
} from '../src/aiFeatures/integration/featureServiceFixtures';
import { createConversationArtifactStorage } from '../src/storage/conversationArtifactStorage';
import { settingsConsentRepository } from '../src/storage/settingsConsentRepository';
import { createSettingsConsentStorage } from '../src/storage/settingsConsentStorage';
import { createAppointmentStore } from '../test-helpers/appointmentStore';
import {
  account,
  finished,
  installSyntheticWebAccount,
  model,
  providerId,
  sourceUrl,
  syntheticBridge,
  title,
} from '../test-helpers/syntheticPublicWebBridge';

jest.mock('../src/storage/settingsConsentAuthority', () =>
  jest.requireActual(
    '../src/agent/execution/testSupport/syntheticConsentAuthority',
  ),
);
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'synthetic' },
  STORAGE_TYPE: { RSA: 'KeystoreRSAECB' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));
jest.mock('../src/storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
jest.mock('../src/agent/execution/settingsConsentCredential', () => ({
  // This replaces only the native account witness, not Settings review, grants, or authorization.
  settingsConsentCredential: async (selectedProviderId: string) =>
    selectedProviderId === 'chatgpt-plan:synthetic-account:gpt-synthetic'
      ? {
          epoch: 'synthetic-device-epoch',
          isCurrent: () => true,
          subscribe: () => () => {},
        }
      : null,
}));
jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test.each([
  {
    scenario: 'retains the visible cited result without an unavailable notice',
    invalidCitation: false,
  },
  {
    scenario:
      'rejects a final answer that cites a reference not supplied by the deployed workflow',
    invalidCitation: true,
  },
])(
  'Settings-approved public web in App: $scenario',
  async ({ invalidCitation }) => {
    const phase = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const sqlite = openSqliteTestDatabase(':memory:');
    await runMigrations(sqlite.database);
    const artifactStorage = createConversationArtifactStorage(sqlite.database);
    const settingsStorage = createSettingsConsentStorage(sqlite.database);
    jest.mocked(settingsConsentRepository).mockResolvedValue(settingsStorage);
    const { bridge, publicWeb, citedIds } = syntheticBridge(invalidCitation);
    const europePmc = jest.fn(async () => {
      throw new Error(
        'The synthetic public-web turn must not dispatch Europe PMC',
      );
    });
    const loadAccountSummary = installSyntheticWebAccount();
    const data = {
      ...localData([]).data,
      openConversationArtifactStorage: async () => artifactStorage,
    };
    const appointmentStore = createAppointmentStore();
    const app = await render(
      <App
        loadAppointments={async () => appointmentStore.repository}
        loadRecordings={async () => []}
        aiFeatureServiceDependencies={{
          selectedAi: { loadAppleOption: async () => apple },
          loadLocalData: async () => data,
          externalEvidence: { search: europePmc },
        }}
      />,
    );
    try {
      const press = async (id: string) =>
        fireEvent.press(await screen.findByTestId(id));
      await press('navigation-tab-settings');
      await press('settings-open-provider');
      expect(
        await settingsStorage.read('conversation', 'public-web'),
      ).toBeNull();
      expect(publicWeb).not.toHaveBeenCalled();

      await press('settings-provider-load-models');
      await fireEvent.press(await screen.findByText(model.displayName));
      await press('provider-selection-confirm');
      expect(
        await screen.findByTestId('inference-disclosure-scope'),
      ).toHaveTextContent(/공개 웹검색/);
      expect(
        await settingsStorage.read('conversation', 'public-web'),
      ).toBeNull();
      await press('inference-disclosure-allow');
      await screen.findByTestId('settings-title');
      expect(
        await settingsStorage.read('conversation', 'public-web'),
      ).toMatchObject({
        identity: { providerId, modelId: model.slug },
        permissions: [
          expect.objectContaining({ purpose: 'public_web_search' }),
        ],
      });

      await press('navigation-tab-conversation');
      await fireEvent.changeText(
        await screen.findByTestId('rag-conversation-input'),
        '혈압의 일반적인 의미가 궁금해요.',
      );
      const send = await screen.findByTestId('rag-conversation-send');
      // Emit the native glass control's press event; the mounted app retains admission.
      await fireEvent(send, 'composerPress');
      if (invalidCitation) {
        expect(
          await screen.findByTestId('rag-conversation-incomplete-activity'),
        ).toHaveTextContent(/답변을 확인하지 못해 표시하지 않았어요/);
        expect(screen.queryByTestId('rag-conversation-answer-body')).toBeNull();
        expect(screen.queryByTestId('rag-conversation-sources')).toBeNull();
        const completions = await sqlite.database.execute(
          'SELECT message_id FROM conversation_completions',
        );
        expect(completions.rows).toHaveLength(0);
      } else {
        const answer = await screen.findByTestId(
          'rag-conversation-answer-body',
        );
        expect(answer).toHaveTextContent(
          /합성 공개 자료에는 추가 확인이 필요하다고 적혀 있어요\./,
        );
        expect(answer).toHaveTextContent(
          /공개 웹자료를 바탕으로 AI가 정리한 설명/,
        );
        expect(answer).not.toHaveTextContent(
          /공개 웹검색을 사용할 수 없어 검색 결과를 반영하지 못했어요\./,
        );
        const sources = await screen.findByTestId('rag-conversation-sources');
        expect(
          within(sources).getByRole('link', {
            name: `웹 출처 열기 · ${title}`,
          }),
        ).toBeVisible();
        expect(
          screen.getAllByTestId('rag-conversation-answer-body'),
        ).toHaveLength(1);
        expect(screen.getAllByTestId('rag-conversation-sources')).toHaveLength(
          1,
        );
        expect(screen.queryByTestId('rag-conversation-error')).toBeNull();
      }
      expect(loadAccountSummary.mock.calls).toEqual([[account]]);
      expect(publicWeb).toHaveBeenCalledTimes(1);
      expect(publicWeb.mock.calls[0]?.slice(1)).toEqual([
        account,
        expect.objectContaining({
          model: model.slug,
          publicWebQuery: expect.stringContaining('blood pressure'),
        }),
      ]);
      expect(europePmc).not.toHaveBeenCalled();
      expect(citedIds[0]).toEqual([expect.any(String)]);
      const persistedTools = await sqlite.database.execute(
        "SELECT event_json FROM conversation_tool_events WHERE json_extract(event_json, '$.toolName') = ?",
        ['public-web-search'],
      );
      expect(
        persistedTools.rows.map(row => JSON.parse(String(row.event_json))),
      ).toEqual([
        expect.objectContaining({
          status: 'completed',
          sources: [expect.objectContaining({ sourceId: 'public-web' })],
        }),
      ]);
      if (invalidCitation) return;
      expect(bridge.started).toHaveLength(3);
      expect(citedIds).toHaveLength(1);
      await waitFor(async () => {
        const { rows } = await sqlite.database.execute(
          'SELECT message_id FROM conversation_completions',
        );
        expect(rows).toHaveLength(1);
        const id = rows[0]?.message_id;
        if (typeof id !== 'string')
          throw new Error('Missing completed synthetic response');
        expect(await artifactStorage.read(id)).toMatchObject({
          answer: expect.stringContaining(finished),
          citations: [
            expect.objectContaining({
              sourceId: 'public-web',
              locator: expect.objectContaining({
                kind: 'public_web_search',
                sources: [{ title, url: sourceUrl }],
              }),
            }),
          ],
        });
      });
    } finally {
      await app.unmount();
      if (phase) Object.defineProperty(AppState, 'currentState', phase);
      jest.restoreAllMocks();
      sqlite.close();
    }
  },
);
