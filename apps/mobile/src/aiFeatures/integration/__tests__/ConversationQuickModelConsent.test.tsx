import { openSavedWebSettingsFixture } from '../../../providers/selection/testSupport/SavedWebSearchRoundTrip.fixture';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import App from '../../../../App';
import { saveModelSettingsConsent } from '../../../agent/execution/saveModelSettingsConsent';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import * as accounts from '../../../providers/selection/useProviderSelectionAccounts';
import { apple } from '../featureServiceFixtures';

jest.mock('../../../healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../../../healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../../../backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
// The app stack, settings route, consent reviewer, and SQLite repository are real.
// No network-backed inference or HealthKit access is involved.
jest.mock('../featureServices', () => ({
  createAiFeatureServices: () => ({
    conversationSessionOptions: () => ({}),
    sendRagMessage: jest.fn(),
  }),
}));

test.each([
  ['conversation', 'on-device'],
  ['settings', 'on-device'],
  ['conversation', 'remote'],
  ['settings', 'remote'],
] as const)(
  'opens the same model settings from %s for %s',
  async (entry, boundary) => {
    const f = openSavedWebSettingsFixture();
    const local = boundary === 'on-device';
    const option = local
      ? apple
      : {
          ...f.execution.selected.option,
          displayName: 'Synthetic ChatGPT model',
        };
    const next = { providerId: option.provider.id, modelId: option.modelId };
    const prior = { ...f.selection, modelId: 'synthetic-prior-model' };
    const restoreAccounts = jest
      .spyOn(accounts, 'useProviderSelectionAccounts')
      .mockReturnValue({
        appleOption: local ? apple : null,
        options: [option],
        setOptions: jest.fn(),
        accounts: [],
        selectedAccountID: null,
        setSelectedAccountID: jest.fn(),
        accountListReady: true,
        accountListError: false,
        setAccountListError: jest.fn(),
        setAccounts: jest.fn(),
        refreshAccounts: async () => [],
      });
    const motion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    try {
      await saveModelSettingsConsent({
        slot: 'conversation',
        selection: prior,
        recipient: f.recipient,
        remote: true,
        search: { web: true, medical: false },
        store: providerSelectionStore,
        signal: new AbortController().signal,
        isCurrent: () => true,
      });
      const priorWeb = await f.reloaded.read('conversation', 'public-web');
      const view = await render(<App loadRecordings={async () => []} />);
      try {
        const conversation = entry === 'conversation';
        const rootId = conversation
          ? 'rag-conversation-input'
          : 'settings-title';
        const openId = conversation
          ? 'ai-feature-select-provider'
          : 'settings-open-provider';
        const prompt = '보존할 합성 대화 초안';
        const open = async () => {
          await fireEvent.press(await view.findByTestId(openId));
          expect(
            await view.findByTestId('settings-provider-screen'),
          ).toBeTruthy();
          expect(view.queryByTestId('provider-selection-screen')).toBeNull();
          expect(view.getByTestId('model-tab-language')).toHaveProp(
            'accessibilityState',
            expect.objectContaining({ selected: true }),
          );
        };
        const choose = async () => {
          await fireEvent.press(await view.findByTestId('provider-option-0'));
          await waitFor(() =>
            expect(
              view.getByTestId('provider-selection-confirm'),
            ).toBeEnabled(),
          );
          await fireEvent.press(view.getByTestId('provider-selection-confirm'));
        };
        await fireEvent.press(
          await view.findByTestId('navigation-tab-' + entry),
        );
        if (conversation)
          await fireEvent.changeText(await view.findByTestId(rootId), prompt);
        await open();
        const originalSettings = view.getByTestId('settings-provider-screen');
        await fireEvent.press(view.getByTestId('chatgpt-account-details'));
        await fireEvent.press(
          view.getByTestId('settings-provider-manage-accounts'),
        );
        expect(
          await view.findByTestId('settings-accounts-screen'),
        ).toBeTruthy();
        await fireEvent.press(view.getByTestId('navigation-back'));
        expect(await view.findByTestId('settings-provider-screen')).toBe(
          originalSettings,
        );
        await choose();
        const scope = await view.findByTestId('inference-disclosure-scope');
        expect(scope).toHaveTextContent(/Europe PMC[\s\S]+의학 문헌/);
        if (local) {
          expect(scope).toHaveTextContent(
            /^Europe PMC에는 의학 문헌 검색어만 전송합니다[.] 건강 기록 원문이나 대화 전체를 검색 요청에 첨부하지 않습니다[.]$/,
          );
        } else {
          expect(scope).toHaveTextContent(/공개 웹검색/);
        }
        await fireEvent.press(view.getByTestId('inference-disclosure-cancel'));
        expect(await providerSelectionStore.load()).toEqual(prior);
        expect(await f.reloaded.read('conversation', 'public-web')).toEqual(
          priorWeb,
        );
        expect(
          await f.reloaded.read('conversation', 'medical-search'),
        ).toBeNull();
        expect(view.getByTestId('settings-provider-screen')).toBeTruthy();
        await fireEvent.press(view.getByTestId('provider-selection-confirm'));
        await fireEvent.press(
          await view.findByTestId('inference-disclosure-allow'),
        );
        await view.findByTestId(rootId);
        expect(await providerSelectionStore.load()).toEqual(next);
        if (conversation)
          expect(view.getByTestId(rootId)).toHaveDisplayValue(prompt);
        expect(
          await f.reloaded.read('conversation', 'medical-search'),
        ).toMatchObject({
          identity: { recipient: 'Europe PMC' },
          permissions: [{ purpose: 'public_medical_search' }],
        });
        if (local)
          expect(await f.reloaded.read('conversation', 'public-web')).toEqual(
            priorWeb,
          );
        else
          expect(
            await f.reloaded.read('conversation', 'public-web'),
          ).toMatchObject({
            identity: next,
            permissions: [{ purpose: 'public_web_search' }],
          });
        await open();
        const savedRow = await view.findByTestId('provider-option-0');
        await waitFor(() => expect(savedRow).toBeSelected());
        expect(view.getByTestId('provider-selection-confirm')).toBeDisabled();
        expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();
        await fireEvent.press(view.getByTestId('navigation-back'));
        await view.findByTestId(rootId);
        expect(f.execution.search).not.toHaveBeenCalled();
      } finally {
        await view.unmount();
      }
    } finally {
      restoreAccounts.mockRestore();
      motion.mockRestore();
      f.sql.close();
    }
  },
);
