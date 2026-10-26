import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import ProviderSelectionFlow from '../ProviderSelectionFlow';
import { loadAppleSelectionOption } from '../options';
import type { ChatGPTSelectionServices } from '../chatGPTServices';
import type { ProviderSelectionOption, ProviderSelectionStore } from '../types';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../options', () => ({
  ...jest.requireActual('../options'),
  loadAppleSelectionOption: jest.fn(),
}));

describe('ProviderSelectionFlow navigation state', () => {
  it('reports sign-in progress before route leave can unmount the flow', async () => {
    const accountID = 'synthetic-route-guard-account';
    const pendingRejectors: ((reason: { code: string }) => void)[] = [];
    const services: ChatGPTSelectionServices = {
      listAccounts: jest.fn().mockResolvedValue([
        {
          issuedClientID: accountID,
          requiresSignIn: true,
          hasDirectPlanAccess: false,
        },
      ]),
      listModels: jest.fn(),
      signIn: jest.fn(
        () =>
          new Promise((_, reject) => {
            pendingRejectors.push(reject);
          }),
      ),
      signOut: jest.fn(),
      cancelSignIn: jest.fn(() => {
        pendingRejectors.shift()?.({ code: 'CHATGPT_AUTH_CANCELLED' });
      }),
    };
    const onNavigationStateChange = jest.fn();
    jest.mocked(loadAppleSelectionOption).mockResolvedValue(makeAppleOption());
    const view = await render(
      <ProviderSelectionFlow
        chatGPTServices={services}
        onBack={jest.fn()}
        onNavigationStateChange={onNavigationStateChange}
        selectionStore={makeSelectionStore()}
      />,
    );
    await waitFor(() => expect(services.listAccounts).toHaveBeenCalled());

    const pendingAction = fireEvent.press(
      screen.getByTestId('chatgpt-account-action'),
    );
    await waitFor(() =>
      expect(onNavigationStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ isSigningIn: true }),
      ),
    );

    await view.unmount();
    expect(services.cancelSignIn).toHaveBeenCalledTimes(1);
    await pendingAction;
  });

  it('keeps an unconfirmed choice and a non-cancelable save as separate states', async () => {
    jest.mocked(loadAppleSelectionOption).mockResolvedValue(makeAppleOption());
    let finishSave: (() => void) | undefined;
    const selectionStore = makeSelectionStore();
    selectionStore.save = jest.fn(
      () =>
        new Promise<void>(resolve => {
          finishSave = resolve;
        }),
    );
    const chatGPTServices: ChatGPTSelectionServices = {
      listAccounts: jest.fn().mockResolvedValue([]),
      listModels: jest.fn(),
      signIn: jest.fn(),
      signOut: jest.fn(),
      cancelSignIn: jest.fn(),
    };
    const onNavigationStateChange = jest.fn();
    const onSelectionCommitted = jest.fn();
    await render(
      <ProviderSelectionFlow
        chatGPTServices={chatGPTServices}
        onBack={jest.fn()}
        onNavigationStateChange={onNavigationStateChange}
        onSelectionCommitted={onSelectionCommitted}
        selectionStore={selectionStore}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('provider-option-0')).toBeTruthy(),
    );

    await fireEvent.press(screen.getByTestId('provider-option-0'));
    expect(onNavigationStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hasPendingSelection: true,
        isSavingSelection: false,
        isSigningIn: false,
        inputRevision: 1,
      }),
    );

    const pendingSave = fireEvent.press(
      screen.getByTestId('provider-selection-confirm'),
    );
    await waitFor(() =>
      expect(onNavigationStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          hasPendingSelection: true,
          isSavingSelection: true,
          isSigningIn: false,
          inputRevision: 1,
        }),
      ),
    );
    finishSave?.();
    await pendingSave;

    expect(onNavigationStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hasPendingSelection: false,
        isSavingSelection: false,
        isSigningIn: false,
        inputRevision: 2,
      }),
    );
    expect(onSelectionCommitted).toHaveBeenCalledTimes(1);
  });
});

function makeAppleOption(): ProviderSelectionOption {
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'apple-foundation-models',
    displayName: 'Apple Intelligence',
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: true,
      toolCalling: true,
    },
    generate: async () =>
      providerSuccess({ text: '', toolCalls: [], finishReason: 'complete' }),
  };
  return {
    provider,
    modelId: 'system-default',
    displayName: 'Apple Intelligence',
    privacyBoundary: 'on-device',
    availability: { status: 'available' },
  };
}

function makeSelectionStore(): ProviderSelectionStore {
  return {
    load: async () => null,
    save: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
}
