import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { providerFailure, providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { listOpenAIAccounts, listOpenAIPlanModels } from '../../openai';
import ProviderSelectionFlow from '../ProviderSelectionFlow';
import { loadAppleSelectionOption } from '../options';
import { providerSelectionText } from '../text';
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
