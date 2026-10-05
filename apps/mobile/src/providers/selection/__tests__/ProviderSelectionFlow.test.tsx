import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { providerFailure, providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import {
  listOpenAIAccounts,
  listOpenAIPlanModels,
  signInToOpenAI,
} from '../../openai';
import ProviderSelectionFlow from '../ProviderSelectionFlow';
import { loadAppleSelectionOption } from '../options';
import { providerSelectionText } from '../text';
import type { ChatGPTSelectionServices } from '../chatGPTServices';
import type {
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionStore,
} from '../types';

// Unit tests have no native window; Detox covers real device insets and hit targets.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../../openai', () => ({
  cancelOpenAISignIn: jest.fn(),
  listOpenAIAccounts: jest.fn(),
  listOpenAIPlanModels: jest.fn(),
  signInToOpenAI: jest.fn(),
}));

jest.mock('../options', () => ({
  ...jest.requireActual('../options'),
  loadAppleSelectionOption: jest.fn(),
}));

describe('ProviderSelectionFlow', () => {
  it('keeps a saved ChatGPT selection blocked when its remote model catalog fails', async () => {
    const accountID = 'synthetic-account';
    const savedSelection = {
      providerId: `chatgpt-plan:${accountID}:gpt-synthetic`,
      modelId: 'gpt-synthetic',
    };
    const apple = makeAppleOption();
    const selectionStore = makeSelectionStore(savedSelection);
    const onSelectionCommitted = jest.fn();
    jest.mocked(loadAppleSelectionOption).mockResolvedValue(apple);
    jest.mocked(listOpenAIAccounts).mockResolvedValue([
      {
        issuedClientID: accountID,
        requiresSignIn: false,
        hasDirectPlanAccess: true,
      },
    ]);
    jest.mocked(listOpenAIPlanModels).mockResolvedValue(
      providerFailure({
        code: 'provider_unavailable',
        message: 'Remote model catalog failed.',
        retryable: true,
      }),
    );

    await render(
      <ProviderSelectionFlow
        onBack={jest.fn()}
        onSelectionCommitted={onSelectionCommitted}
        selectionStore={selectionStore}
      />,
    );
    await waitFor(() => expect(listOpenAIAccounts).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('chatgpt-account-action'));

    await waitFor(() =>
      expect(listOpenAIPlanModels).toHaveBeenCalledWith(accountID),
    );
    expect(
      screen.getByText(providerSelectionText.chatGPTModelsUnavailable),
    ).toBeTruthy();
    expect(
      screen.getByText(providerSelectionText.unavailableSelection),
    ).toBeTruthy();
    expect(selectionStore.save).not.toHaveBeenCalled();
    expect(onSelectionCommitted).not.toHaveBeenCalled();
  });

  it('offers reauthorization when the selected account is rejected by the catalog', async () => {
    const accountID = 'synthetic-account';
    const savedSelection = {
      providerId: `chatgpt-plan:${accountID}:gpt-synthetic`,
      modelId: 'gpt-synthetic',
    };
    const apple = makeAppleOption();
    jest.mocked(loadAppleSelectionOption).mockResolvedValue(apple);
    jest.mocked(listOpenAIAccounts).mockResolvedValue([
      {
        issuedClientID: accountID,
        requiresSignIn: false,
        hasDirectPlanAccess: true,
      },
    ]);
    jest.mocked(listOpenAIPlanModels).mockResolvedValue(
      providerFailure({
        code: 'authentication_required',
        message: 'The selected account needs authorization.',
        retryable: false,
      }),
    );
    jest.mocked(signInToOpenAI).mockResolvedValue({
      issuedClientID: accountID,
      requiresSignIn: false,
      hasDirectPlanAccess: true,
    });

    await render(
      <ProviderSelectionFlow
        onBack={jest.fn()}
        selectionStore={makeSelectionStore(savedSelection)}
      />,
    );
    await waitFor(() => expect(listOpenAIAccounts).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('chatgpt-account-action'));

    await waitFor(() =>
      expect(listOpenAIPlanModels).toHaveBeenCalledWith(accountID),
    );
    expect(
      screen.getByText(providerSelectionText.chatGPTAccountSignedOut),
    ).toBeTruthy();
    expect(
      screen.getByText(providerSelectionText.chatGPTReauthorize),
    ).toBeTruthy();
    expect(
      screen.getByText(providerSelectionText.unavailableSelection),
    ).toBeTruthy();

    await fireEvent.press(screen.getByTestId('chatgpt-account-action'));
    await waitFor(() => expect(signInToOpenAI).toHaveBeenCalledWith(accountID));
  });

  it('cancels a pending sign-in when the selection route unmounts', async () => {
    const accountID = 'synthetic-signed-out-account';
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
      cancelSignIn: jest.fn(() => {
        pendingRejectors.shift()?.({ code: 'CHATGPT_AUTH_CANCELLED' });
      }),
    };
    const view = await render(
      <ProviderSelectionFlow
        chatGPTServices={services}
        onBack={jest.fn()}
        selectionStore={makeSelectionStore(null)}
      />,
    );
    await waitFor(() => expect(services.listAccounts).toHaveBeenCalled());

    const pendingAction = fireEvent.press(
      screen.getByTestId('chatgpt-account-action'),
    );
    await waitFor(() => expect(services.signIn).toHaveBeenCalledTimes(1));
    await view.unmount();
    expect(services.cancelSignIn).toHaveBeenCalledTimes(1);
    await pendingAction;

    const reopened = await render(
      <ProviderSelectionFlow
        chatGPTServices={services}
        onBack={jest.fn()}
        selectionStore={makeSelectionStore(null)}
      />,
    );
    await waitFor(() => expect(services.listAccounts).toHaveBeenCalledTimes(2));
    const reopenedAction = fireEvent.press(
      screen.getByTestId('chatgpt-account-action'),
    );
    await waitFor(() => expect(services.signIn).toHaveBeenCalledTimes(2));
    await reopened.unmount();
    expect(services.cancelSignIn).toHaveBeenCalledTimes(2);
    await reopenedAction;
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

function makeSelectionStore(
  savedSelection: ProviderSelection | null,
): ProviderSelectionStore {
  return {
    load: async () => savedSelection,
    save: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
}
