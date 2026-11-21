import { openSavedWebSettingsFixture } from '../../../providers/selection/testSupport/SavedWebSearchRoundTrip.fixture';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { saveModelSettingsConsent } from '../../../agent/execution/saveModelSettingsConsent';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import * as accounts from '../../../providers/selection/useProviderSelectionAccounts';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { apple } from '../featureServiceFixtures';

// Only isolate unrelated inference/report services. The real Conversation route, picker,
// review coordinator, SQLite settings repository and selection writer all run below.
jest.mock('../featureServices', () => ({
  createAiFeatureServices: () => ({
    conversationSessionOptions: () => ({}),
    sendRagMessage: jest.fn(),
  }),
}));

test.each(['remote', 'on-device'] as const)(
  'reviews the model selected from the Conversation header without broadening local access: %s',
  async boundary => {
    const f = openSavedWebSettingsFixture();
    const local = boundary === 'on-device';
    const option = local
      ? apple
      : {
          ...f.execution.selected.option,
          modelId: f.selection.modelId,
          displayName: 'Synthetic ChatGPT model',
        };
    const prior = { ...f.selection, modelId: 'synthetic-prior-model' };
    const committed = jest.fn();
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
      const view = await render(
        <AiFeatureRoute
          initialRoute="rag-conversation"
          onBack={jest.fn()}
          onProviderSelectionCommitted={committed}
          serviceDependencies={{
            selectedAi: { selectionStore: providerSelectionStore },
          }}
        />,
      );
      try {
        const id = 'rag-conversation-input';
        const prompt = '보존할 합성 대화 초안';
        const choose = async () => {
          await fireEvent.press(await view.findByTestId('provider-option-0'));
          await waitFor(() =>
            expect(
              view.getByTestId('provider-selection-confirm'),
            ).toBeEnabled(),
          );
          await fireEvent.press(view.getByTestId('provider-selection-confirm'));
        };
        await fireEvent.changeText(await view.findByTestId(id), prompt);
        await fireEvent.press(view.getByTestId('ai-feature-select-provider'));
        expect(
          await view.findByTestId('provider-selection-screen'),
        ).toBeTruthy();
        await choose();
        if (local) {
          await waitFor(() => expect(committed).toHaveBeenCalledTimes(1));
          expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();
          expect(await providerSelectionStore.load()).toEqual({
            providerId: option.provider.id,
            modelId: option.modelId,
          });
          expect(
            await f.reloaded.read('conversation', 'medical-search'),
          ).toBeNull();
          return;
        }
        expect(
          await view.findByTestId('inference-disclosure-scope'),
        ).toHaveTextContent(/공개 웹검색[\s\S]+Europe PMC[\s\S]+의학 문헌/);
        expect(view.queryByTestId('settings-consent-medical')).toBeNull();
        expect(await providerSelectionStore.load()).toEqual(prior);
        expect(await f.reloaded.read('conversation', 'public-web')).toEqual(
          priorWeb,
        );
        expect(
          await f.reloaded.read('conversation', 'medical-search'),
        ).toBeNull();
        await fireEvent.press(view.getByTestId('inference-disclosure-cancel'));
        expect(await providerSelectionStore.load()).toEqual(prior);
        expect(await f.reloaded.read('conversation', 'public-web')).toEqual(
          priorWeb,
        );
        expect(
          await f.reloaded.read('conversation', 'medical-search'),
        ).toBeNull();
        expect(committed).not.toHaveBeenCalled();
        expect(
          view
            .getAllByTestId(id, { includeHiddenElements: true })
            .some(control => control.props.value === prompt),
        ).toBe(true);
        await fireEvent.press(view.getByTestId('provider-selection-confirm'));
        await fireEvent.press(
          await view.findByTestId('inference-disclosure-allow'),
        );
        await waitFor(() => expect(committed).toHaveBeenCalledTimes(1));
        expect(await providerSelectionStore.load()).toEqual(f.selection);
        expect(
          await f.reloaded.read('conversation', 'medical-search'),
        ).toMatchObject({
          identity: { recipient: 'Europe PMC' },
          permissions: [{ purpose: 'public_medical_search' }],
        });
        expect(
          await f.reloaded.read('conversation', 'public-web'),
        ).toMatchObject({
          identity: f.selection,
          permissions: [{ purpose: 'public_web_search' }],
        });
        await fireEvent.press(
          await view.findByTestId('ai-feature-select-provider'),
        );
        await choose();
        await waitFor(() => expect(committed).toHaveBeenCalledTimes(2));
        expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();
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
