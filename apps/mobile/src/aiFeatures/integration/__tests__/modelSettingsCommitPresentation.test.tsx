import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppButton } from '../../../layout/AppButton';
import { SettingsProviderRoute } from '../../../routes/SettingsProviderRoute';
import type { AppNavigationRoute } from '../../../routes/appNavigationRoute';
import type { NavigationRouteActions } from '../../../navigation/NavigationRouteAdapter';
import type { ProviderSelection } from '../../../providers/selection/types';
import {
  AiFeatureSharedNavigationStateProvider,
  useAiFeatureSharedNavigationState,
} from '../AiFeatureSharedNavigationState';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import {
  createAppleSelectionOption,
  createChatGPTSelectionOptions,
} from '../../../providers/selection/options';
import type { ResolveConversationModelDisplay } from '../provider';

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));
jest.mock('../../../navigation', () => ({
  useNavigationLeaveStateRegistration: () => undefined,
}));
const mockChooser = jest.fn();
jest.mock('../../../providers/selection/ProviderSelectionFlow', () => ({
  __esModule: true,
  default: (props: unknown) => mockChooser(props),
}));

const apple = createAppleSelectionOption('available');
const [chatGPT, otherChatGPT] = createChatGPTSelectionOptions(
  'fixture-account',
  [
    { slug: 'fixture-first', displayName: 'First ChatGPT Model' },
    { slug: 'fixture-second', displayName: 'Second ChatGPT Model' },
  ],
);
const pair = (option: typeof apple): ProviderSelection => ({
  providerId: option.provider.id,
  modelId: option.modelId,
});
type Verified = Awaited<ReturnType<ResolveConversationModelDisplay>>;
function ready(option: typeof apple): Verified {
  return {
    status: 'ready',
    selection: pair(option),
    option,
    provider: option.provider,
    modelId: option.modelId,
    recipient: 'fixture',
    remoteProcessing: option !== apple,
  };
}

it.each([apple, otherChatGPT])(
  'updates a retained Conversation after Settings confirms $displayName and ignores old in-flight selection',
  async option => {
    let finishPrevious!: (value: Verified) => void;
    const previous = new Promise<Verified>(resolve => {
      finishPrevious = resolve;
    });
    let persisted = chatGPT;
    let live = 0;
    let change = () => {};
    const resolve: ResolveConversationModelDisplay = jest.fn(async observer => {
      const witnessed = live;
      observer?.selection({
        isCurrent: () => witnessed === live,
        subscribe(listener) {
          change = listener;
          return () => {
            change = () => {};
          };
        },
      });
      return persisted === chatGPT ? previous : ready(persisted);
    });
    mockChooser.mockImplementation(({ onSelectionCommitted }) => (
      <AppButton
        testID="settings-model-commit"
        title="Confirm fixture"
        onPress={() => {
          // Persist before notifying exactly as the production settings writer does.
          live++;
          change();
          persisted = option;
          onSelectionCommitted(pair(option), option.provider);
        }}
      />
    ));
    const actions = {
      route: { key: 'fixture-settings', name: 'settings-provider' },
      onBack: jest.fn(async () => undefined),
    } as unknown as NavigationRouteActions<AppNavigationRoute>;
    function RetainedConversation() {
      const { state } = useAiFeatureSharedNavigationState();
      return (
        <AiProviderSelectorRow
          onPress={jest.fn()}
          resolveSelectedAi={resolve}
          revision={state.selectedAiRevision}
        />
      );
    }
    await render(
      <AiFeatureSharedNavigationStateProvider>
        <RetainedConversation />
        <SettingsProviderRoute
          actions={actions}
          onSelectionCommitted={jest.fn()}
        />
      </AiFeatureSharedNavigationStateProvider>,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('settings-model-commit'));
    expect(await screen.findByText(option.displayName)).toBeTruthy();
    await act(() => finishPrevious(ready(chatGPT)));
    expect(screen.queryByText(chatGPT.displayName)).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(actions.onBack).toHaveBeenCalledTimes(1);
  },
);
