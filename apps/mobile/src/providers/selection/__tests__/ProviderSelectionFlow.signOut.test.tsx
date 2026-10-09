import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import ProviderSelectionFlow from '../ProviderSelectionFlow';
import type { ChatGPTSelectionServices } from '../chatGPTServices';
import { loadAppleSelectionOption } from '../options';
import { providerSelectionText } from '../text';
import type { OpenAIAccountSummary, OpenAISignOutResult } from '../../openai';
import type {
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionStore,
} from '../types';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../../openai', () => ({
  cancelOpenAISignIn: jest.fn(),
  listOpenAIAccounts: jest.fn(),
  listOpenAIPlanModels: jest.fn(),
  signOutFromOpenAI: jest.fn(),
  signInToOpenAI: jest.fn(),
}));

jest.mock('../options', () => ({
  ...jest.requireActual('../options'),
  loadAppleSelectionOption: jest.fn(),
}));

describe('ProviderSelectionFlow sign-out', () => {
  beforeEach(() => {
    jest.mocked(loadAppleSelectionOption).mockResolvedValue(makeAppleOption());
  });

  it('logs out only the selected numbered account and keeps its saved choice unavailable', async () => {
    const selectedID = 'synthetic-account-a';
    const selectionStore = makeSelectionStore({
      providerId: `chatgpt-plan:${selectedID}:gpt-synthetic`,
      modelId: 'gpt-synthetic',
    });
    const accounts = [
      makeAccount('synthetic-account-b'),
      makeAccount(selectedID),
    ];
    const services = makeServices({
      listAccounts: jest
        .fn()
        .mockResolvedValueOnce(accounts)
        .mockResolvedValueOnce([
          makeAccount('synthetic-account-b'),
          makeAccount(selectedID, true),
        ]),
      signOut: jest
        .fn()
        .mockResolvedValue('revoked' satisfies OpenAISignOutResult),
    });

    await renderFlow(services, selectionStore);
    await waitFor(() => expect(services.listAccounts).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByTestId('chatgpt-account-0'));
    expect(
      screen.getByText(providerSelectionText.chatGPTSignOutAccount(1)),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('chatgpt-account-sign-out'));

    await waitFor(() =>
      expect(services.signOut).toHaveBeenCalledWith(selectedID),
    );
    expect(
      screen.getByText(providerSelectionText.chatGPTSignOutRemoteConfirmed(1)),
    ).toBeTruthy();
    expect(
      screen.getByText(providerSelectionText.unavailableSelection),
    ).toBeTruthy();
    expect(
      screen.getByText(providerSelectionText.chatGPTReauthorize),
    ).toBeTruthy();
    expect(screen.queryByTestId('chatgpt-account-sign-out')).toBeNull();
    expect(services.listModels).not.toHaveBeenCalled();
    expect(selectionStore.save).not.toHaveBeenCalled();
  });

  it('explains when only local credentials were cleared', async () => {
    const services = makeServices({
      listAccounts: jest
        .fn()
        .mockResolvedValueOnce([makeAccount('synthetic-account')])
        .mockResolvedValueOnce([makeAccount('synthetic-account', true)]),
      signOut: jest
        .fn()
        .mockResolvedValue(
          'localCredentialsCleared' satisfies OpenAISignOutResult,
        ),
    });

    await renderFlow(services, makeSelectionStore(null));
    await waitFor(() => expect(services.listAccounts).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByTestId('chatgpt-account-sign-out'));

    await waitFor(() =>
      expect(
        screen.getByText(providerSelectionText.chatGPTSignOutLocalOnly(1)),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText(
        providerSelectionText.chatGPTSignOutRemoteConfirmed(1),
      ),
    ).toBeNull();
  });

  it('keeps a failed sign-out retryable and does not claim credentials were removed', async () => {
    const services = makeServices({
      listAccounts: jest
        .fn()
        .mockResolvedValueOnce([makeAccount('synthetic-account')])
        .mockResolvedValueOnce([makeAccount('synthetic-account')]),
      signOut: jest.fn().mockRejectedValue(new Error('synthetic failure')),
    });

    await renderFlow(services, makeSelectionStore(null));
    await waitFor(() => expect(services.listAccounts).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByTestId('chatgpt-account-sign-out'));

    await waitFor(() =>
      expect(
        screen.getByText(providerSelectionText.chatGPTSignOutFailed(1)),
      ).toBeTruthy(),
    );
    expect(screen.getByTestId('chatgpt-account-sign-out')).toBeTruthy();
    expect(services.listModels).not.toHaveBeenCalled();
  });
});

function makeServices(
  overrides: Partial<ChatGPTSelectionServices> = {},
): ChatGPTSelectionServices {
  return {
    listAccounts: jest.fn().mockResolvedValue([]),
    listModels: jest.fn().mockResolvedValue(providerSuccess([])),
    signIn: jest.fn().mockResolvedValue(makeAccount('synthetic-account')),
    signOut: jest.fn().mockResolvedValue('revoked'),
    cancelSignIn: jest.fn(),
    ...overrides,
  };
}

function makeAccount(
  issuedClientID: string,
  requiresSignIn = false,
): OpenAIAccountSummary {
  return {
    issuedClientID,
    requiresSignIn,
    hasDirectPlanAccess: !requiresSignIn,
  };
}

async function renderFlow(
  chatGPTServices: ChatGPTSelectionServices,
  selectionStore: ProviderSelectionStore,
) {
  return render(
    <ProviderSelectionFlow
      chatGPTServices={chatGPTServices}
      onBack={jest.fn()}
      selectionStore={selectionStore}
    />,
  );
}

function makeSelectionStore(
  selection: ProviderSelection | null,
): ProviderSelectionStore {
  return {
    load: jest.fn().mockResolvedValue(selection),
    save: jest.fn(),
    clear: jest.fn(),
  };
}

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
