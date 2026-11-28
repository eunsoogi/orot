import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import ProviderSelectionFlow from '../ProviderSelectionFlow';
import { createAppleSelectionOption } from '../options';
import type { ChatGPTSelectionServices } from '../chatGPTServices';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import { readChatGPTConsentCredential } from '../../chatGPTConsentIdentity';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../../chatGPTConsentIdentity', () => ({
  chatGPTCredentialMutation: {
    capture: () => () => true,
    subscribe: () => () => undefined,
  },
  readChatGPTConsentCredential: jest.fn(),
}));

// Route tests retain the actual disclosure and solely substitute the persistence
// service; the independent Keychain test covers the durable write format.
jest.mock('../../../agent/execution/saveModelSettingsConsent', () => ({
  saveModelSettingsConsent: async (input: {
    store: { save(value: unknown): Promise<void> };
    selection: unknown;
  }) => input.store.save(input.selection),
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => false),
}));

const services: ChatGPTSelectionServices = {
  listAccounts: jest.fn(async () => [
    {
      issuedClientID: 'fixture',
      hasDirectPlanAccess: true,
      requiresSignIn: false,
    },
  ]),
  listModels: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
  cancelSignIn: jest.fn(),
};
const loadAppleOption = async () => createAppleSelectionOption('available');

const credential = jest.mocked(readChatGPTConsentCredential);
const choice = {
  providerId: 'chatgpt-plan:fixture:gpt-fixture',
  modelId: 'gpt-fixture',
};

function show(selected = choice, name = 'Synthetic Friendly Name') {
  const store = {
    load: jest.fn(async () => selected),
    save: jest.fn(),
    clear: jest.fn(),
    loadTitle: jest.fn(async () => name),
    rememberTitle: jest.fn(),
  };
  return {
    store,
    mounted: render(
      <ProviderSelectionFlow
        presentation="settings-provider"
        chatGPTServices={services}
        loadAppleOption={loadAppleOption}
        selectionStore={store}
        onBack={jest.fn()}
      />,
    ),
  };
}

it('shows the same local ChatGPT title on a reconstructed settings route without a catalog or a new grant', async () => {
  credential.mockResolvedValue({
    epoch: 'existing-exact-account-epoch',
    isCurrent: () => true,
    subscribe: () => () => undefined,
  });
  const { mounted, store } = show();
  await mounted;
  expect(await screen.findByText('Synthetic Friendly Name')).toBeTruthy();
  expect(store.loadTitle).toHaveBeenCalledWith(
    choice,
    'existing-exact-account-epoch',
  );
  expect(store.rememberTitle).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
  expect(
    screen
      .getAllByRole('radio')
      .find(row => row.props.accessibilityState?.selected),
  ).toContainElement(screen.getByText('Synthetic Friendly Name'));
});

it('does not reveal a saved model title without the exact account credential', async () => {
  credential.mockResolvedValue(null);
  const { mounted, store } = show({
    providerId: 'chatgpt-plan:fixture:gpt-6.2-sol',
    modelId: 'gpt-6.2-sol',
  });
  await mounted;
  await screen.findByTestId('settings-provider-load-models');
  expect(screen.queryByText('GPT-6.2 Sol')).toBeNull();
  expect(screen.queryByText('Synthetic Friendly Name')).toBeNull();
  expect(store.loadTitle).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});

it('remembers a catalog title only after the existing Settings disclosure is accepted, then reloads without the catalog', async () => {
  credential.mockResolvedValue({
    epoch: 'fixture-accepted-credential',
    isCurrent: () => true,
    subscribe: () => () => undefined,
  });
  let selected: typeof choice | null = null;
  let title: string | undefined;
  const store = {
    load: jest.fn(async () => selected),
    save: jest.fn(async (value: typeof choice) => {
      selected = value;
    }),
    clear: jest.fn(),
    loadTitle: jest.fn(async () => title),
    rememberTitle: jest.fn(
      async (_pair, value: { name: string }, current: () => boolean) => {
        if (current()) title = value.name;
      },
    ),
  };
  const provider = {
    kind: 'language-model' as const,
    id: choice.providerId,
    displayName: 'Fixture provider',
    capabilities: {
      inputTypes: ['text'] as const,
      streaming: true,
      structuredOutput: false,
      toolCalling: true,
    },
    generate: jest.fn(),
  };
  const first = await render(
    <ProviderSelectionScreen
      presentation="settings-provider"
      options={[
        {
          provider,
          modelId: choice.modelId,
          displayName: 'Friendly Catalog Title',
          privacyBoundary: 'selected-context-remote',
          availability: { status: 'available' },
        },
      ]}
      requirements={{ inputTypes: ['text'] }}
      selectionStore={store}
    />,
  );
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
  const allow = await screen.findByTestId('inference-disclosure-allow');
  expect(store.rememberTitle).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
  await fireEvent.press(allow);
  await waitFor(() =>
    expect(store.rememberTitle).toHaveBeenCalledWith(
      choice,
      { name: 'Friendly Catalog Title', epoch: 'fixture-accepted-credential' },
      expect.any(Function),
    ),
  );
  await first.unmount();
  await render(
    <ProviderSelectionFlow
      presentation="settings-provider"
      chatGPTServices={services}
      loadAppleOption={loadAppleOption}
      selectionStore={store}
      onBack={jest.fn()}
    />,
  );
  expect(await screen.findByText('Friendly Catalog Title')).toBeTruthy();
  expect(store.save).toHaveBeenCalledTimes(1);
  expect(provider.generate).not.toHaveBeenCalled();
});
