import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { createAppleSelectionOption } from '../options';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import { providerSelectionText } from '../text';
import type {
  ChatGPTAccountSetup,
  ProviderSelection,
  ProviderSelectionPresentation,
} from '../types';

jest.mock('../../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../../navigation/useNavigationContentInset', () => ({
  useNavigationContentInset: () => ({ paddingBottom: 91 }),
  useNavigationOcclusion: () => {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    return { systemInsets: zero, viewportInsets: zero };
  },
}));

const apple = createAppleSelectionOption('available');
const remote = {
  ...apple,
  modelId: 'chosen-model',
  displayName: 'Synthetic remote model',
  privacyBoundary: 'selected-context-remote' as const,
  provider: { ...apple.provider, id: 'chatgpt-plan:synthetic:chosen-model' },
};
const saved = { providerId: apple.provider.id, modelId: apple.modelId };
const requirements = { inputTypes: ['text'] as const };
const pageIDs = {
  feature: 'provider-selection-screen',
  'settings-provider': 'settings-provider-screen',
  'settings-accounts': 'settings-accounts-screen',
};

function accountSetup(
  presentation: ProviderSelectionPresentation,
): ChatGPTAccountSetup {
  return {
    presentation,
    accounts: [],
    selectedAccountID: null,
    statusMessage: providerSelectionText.chatGPTNoAccounts,
    statusIsError: false,
    actionTitle: providerSelectionText.chatGPTSignIn,
    busy: false,
    signingIn: false,
    signingOut: false,
    actionDisabled: false,
    onAccountSelected: jest.fn(),
    onAction: jest.fn(),
    onSignOut: jest.fn(),
    onCancelSignIn: jest.fn(),
  };
}

// Account-only settings must keep their own flow; model routes include confirmation in that flow.
test.each<ProviderSelectionPresentation>([
  'feature',
  'settings-provider',
  'settings-accounts',
])(
  '%s keeps its account, model and final-action content in one page with one inset',
  async presentation => {
    await render(
      <ProviderSelectionScreen
        chatGPTSetup={accountSetup(presentation)}
        options={[apple, remote]}
        presentation={presentation}
        requirements={requirements}
        selectionStore={{
          load: async () => saved,
          save: jest.fn(),
          clear: jest.fn(),
        }}
      />,
    );
    expect(
      screen.container.queryAll(
        node => node.type === 'RCTScrollView' && node.props.horizontal !== true,
      ),
    ).toHaveLength(1);
    const page = screen.getByTestId(pageIDs[presentation]);
    expect(StyleSheet.flatten(page.props.contentContainerStyle)).toMatchObject({
      paddingBottom: 91,
    });
    const content = within(page);
    if (presentation === 'settings-accounts') {
      expect(content.getByTestId('chatgpt-account-setup')).toBeTruthy();
      expect(content.queryByTestId('provider-selection-footer')).toBeNull();
      expect(content.queryByTestId('provider-option-0')).toBeNull();
      return;
    }
    await fireEvent.press(content.getByTestId('provider-option-1'));
    expect(content.getByTestId('provider-selection-footer')).toBeTruthy();
    expect(
      content.getByTestId('provider-selection-confirmation-privacy'),
    ).toHaveTextContent(providerSelectionText.remotePrivacy);
    expect(content.getByTestId('provider-selection-confirm')).toBeEnabled();
    expect(content.getByTestId('provider-selection-cancel')).toBeTruthy();
  },
);

test('retains the saved choice on cancel and keeps failed saves recoverable in the same page', async () => {
  const save = jest
    .fn()
    .mockRejectedValueOnce(new Error('Storage unavailable'))
    .mockResolvedValueOnce(undefined);
  const onSelectionCommitted = jest.fn();
  await render(
    <ProviderSelectionScreen
      options={[apple, remote]}
      requirements={requirements}
      selectionStore={{ load: async () => saved, save, clear: jest.fn() }}
      onSelectionCommitted={onSelectionCommitted}
    />,
  );
  const page = within(screen.getByTestId('provider-selection-screen'));
  await fireEvent.press(page.getByTestId('provider-option-1'));
  await fireEvent.press(page.getByTestId('provider-selection-cancel'));
  expect(
    page.getByTestId('provider-option-0').props.accessibilityState,
  ).toMatchObject({
    selected: true,
  });
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(page.getByTestId('provider-option-1'));
  await fireEvent.press(page.getByTestId('provider-selection-confirm'));
  expect(page.getByText(providerSelectionText.storageSaveError)).toBeTruthy();
  expect(
    page.getByTestId('provider-option-1').props.accessibilityState,
  ).toMatchObject({
    selected: true,
  });
  expect(onSelectionCommitted).not.toHaveBeenCalled();
  await fireEvent.press(page.getByTestId('provider-selection-confirm'));
  await waitFor(() => expect(onSelectionCommitted).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith({
    providerId: remote.provider.id,
    modelId: remote.modelId,
  });
});

test('blocks model choice while loading and leaves unavailable options disabled after loading', async () => {
  let finishLoad: ((value: ProviderSelection | null) => void) | undefined;
  const load = () =>
    new Promise<ProviderSelection | null>(resolve => {
      finishLoad = resolve;
    });
  await render(
    <ProviderSelectionScreen
      options={[
        apple,
        {
          ...remote,
          availability: {
            status: 'unavailable',
            message: 'Synthetic account unavailable',
          },
        },
      ]}
      requirements={requirements}
      selectionStore={{ load, save: jest.fn(), clear: jest.fn() }}
    />,
  );
  expect(screen.getByTestId('provider-option-0')).toBeDisabled();
  expect(screen.getByRole('button', { name: '이 AI 사용' })).toBeDisabled();
  await act(async () => finishLoad?.(saved));
  expect(screen.getByTestId('provider-option-0')).toBeEnabled();
  expect(screen.getByTestId('provider-option-1')).toBeDisabled();
});

test('keeps confirmation disabled until the explicit save settles without duplicate persistence', async () => {
  let finishSave: (() => void) | undefined;
  const save = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finishSave = resolve;
      }),
  );
  const onSelectionCommitted = jest.fn();
  await render(
    <ProviderSelectionScreen
      options={[apple, remote]}
      requirements={requirements}
      selectionStore={{ load: async () => saved, save, clear: jest.fn() }}
      onSelectionCommitted={onSelectionCommitted}
    />,
  );
  const page = within(screen.getByTestId('provider-selection-screen'));
  await fireEvent.press(page.getByTestId('provider-option-1'));
  const pendingSave = fireEvent.press(
    page.getByTestId('provider-selection-confirm'),
  );
  await waitFor(() =>
    expect(page.getByTestId('provider-selection-confirm')).toBeDisabled(),
  );
  expect(page.getByTestId('provider-selection-cancel')).toBeDisabled();
  expect(page.getByTestId('provider-option-0')).toBeDisabled();
  await fireEvent.press(page.getByTestId('provider-selection-confirm'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(onSelectionCommitted).not.toHaveBeenCalled();
  await act(async () => {
    finishSave?.();
    await pendingSave;
  });
  expect(onSelectionCommitted).toHaveBeenCalledTimes(1);
  expect(
    page.getByTestId('provider-option-1').props.accessibilityState,
  ).toMatchObject({ selected: true });
});
