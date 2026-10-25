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
import type { ProviderSelectionOption } from '../types';

// Keep this boundary synthetic: the native auth session and real provider account stay outside this component test.
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

it('refreshes the account and shows success after the auth session returns', async () => {
  const account = {
    issuedClientID: 'synthetic-returned-account',
    requiresSignIn: false,
    hasDirectPlanAccess: true,
  };
  const services: ChatGPTSelectionServices = {
    listAccounts: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([account]),
    listModels: jest.fn(),
    signIn: jest.fn().mockResolvedValue(account),
    signOut: jest.fn(),
    cancelSignIn: jest.fn(),
  };
  jest.mocked(loadAppleSelectionOption).mockResolvedValue(makeAppleOption());

  await render(
    <ProviderSelectionFlow chatGPTServices={services} onBack={jest.fn()} />,
  );
  await waitFor(() => expect(services.listAccounts).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByTestId('chatgpt-account-action'));

  await waitFor(() => expect(services.listAccounts).toHaveBeenCalledTimes(2));
  expect(services.signIn).toHaveBeenCalledWith(undefined);
  expect(
    screen.getByText(providerSelectionText.chatGPTLoginSuccess),
  ).toBeTruthy();
  expect(
    screen.getByText(providerSelectionText.chatGPTLoadModels),
  ).toBeTruthy();
  expect(services.listModels).not.toHaveBeenCalled();
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
