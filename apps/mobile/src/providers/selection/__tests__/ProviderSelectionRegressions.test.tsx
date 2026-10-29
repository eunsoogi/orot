import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { createAppleSelectionOption } from '../options';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import { useProviderSelectionAccounts } from '../useProviderSelectionAccounts';
import type { ChatGPTSelectionServices } from '../chatGPTServices';
import type { ProviderSelection } from '../types';
import { ProviderCatalogAccount } from '../ProviderCatalogAccount';
import { providerSelectionText } from '../text';

const apple = createAppleSelectionOption('available');
const remote = {
  ...apple,
  modelId: 'chosen-model',
  displayName: 'Loaded model',
  privacyBoundary: 'selected-context-remote' as const,
  provider: { ...apple.provider, id: 'chatgpt-plan:account:chosen-model' },
};
const requirements = { inputTypes: ['text'] as const };

test('marks a pending model immediately and keeps confirmation outside the scrolling catalog', async () => {
  let saved: ProviderSelection = {
    providerId: apple.provider.id,
    modelId: apple.modelId,
  };
  const save = jest.fn(async (selection: ProviderSelection) => {
    saved = selection;
  });
  const store = {
    load: async () => saved,
    save,
    clear: async () => {},
  };
  const rendered = await render(
    <ProviderSelectionScreen
      options={[apple, remote]}
      selectionStore={store}
      requirements={requirements}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('provider-option-1').props.accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(screen.getByTestId('provider-option-1'));
  expect(
    screen.getByTestId('provider-option-1').props.accessibilityState.selected,
  ).toBe(true);
  expect(
    screen.getByTestId('provider-option-0').props.accessibilityState.selected,
  ).toBe(false);
  expect(screen.getByTestId('provider-selection-footer')).toBeTruthy();
  expect(
    within(screen.getByTestId('provider-selection-screen')).queryByTestId(
      'provider-selection-confirm',
    ),
  ).toBeNull();
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
  expect(save).toHaveBeenCalledWith({
    providerId: remote.provider.id,
    modelId: remote.modelId,
  });
  await rendered.unmount();
  await render(
    <ProviderSelectionScreen
      options={[apple, remote]}
      selectionStore={store}
      requirements={requirements}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('provider-option-1').props.accessibilityState.selected,
    ).toBe(true),
  );
});

test('late Apple availability preserves an already loaded remote catalog', async () => {
  let release!: (value: typeof apple) => void;
  const pending = new Promise<typeof apple>(resolve => {
    release = resolve;
  });
  const loadAppleOption = () => pending;
  const services = {
    listAccounts: async () => [],
  } as unknown as ChatGPTSelectionServices;
  const { result } = await renderHook(() =>
    useProviderSelectionAccounts({
      chatGPTServices: services,
      loadAppleOption,
      refreshKey: 0,
    }),
  );
  await act(async () => {
    result.current.setOptions([remote]);
  });
  await act(async () => {
    release(apple);
  });
  expect(result.current.options).toEqual([apple, remote]);
});

test('disconnected catalog shows its account guidance once', async () => {
  await render(
    <ProviderCatalogAccount
      setup={{
        presentation: 'settings-provider',
        accounts: [],
        selectedAccountID: null,
        statusMessage: providerSelectionText.chatGPTNoAccounts,
        statusIsError: false,
        actionTitle: '연결',
        busy: false,
        signingIn: false,
        signingOut: false,
        actionDisabled: false,
        onAccountSelected() {},
        onAction() {},
        onSignOut() {},
        onCancelSignIn() {},
      }}
    />,
  );
  expect(
    screen.getAllByText(providerSelectionText.chatGPTNoAccounts),
  ).toHaveLength(1);
});

test('pending sign-in remains cancellable while other account actions are busy', async () => {
  const onCancelSignIn = jest.fn();
  await render(
    <ProviderCatalogAccount
      setup={{
        presentation: 'feature',
        accounts: [],
        selectedAccountID: null,
        statusMessage: '',
        statusIsError: false,
        actionTitle: '로그인',
        busy: true,
        signingIn: true,
        signingOut: false,
        actionDisabled: true,
        onAccountSelected() {},
        onAction() {},
        onSignOut() {},
        onCancelSignIn,
      }}
    />,
  );
  const cancel = screen.getByTestId('chatgpt-cancel-sign-in');
  expect(cancel.props.accessibilityLabel).toBe(
    providerSelectionText.chatGPTCancelLogin,
  );
  expect(cancel.props.accessibilityState).toMatchObject({
    disabled: false,
    busy: true,
  });
  await fireEvent.press(cancel);
  expect(onCancelSignIn).toHaveBeenCalledTimes(1);
});
