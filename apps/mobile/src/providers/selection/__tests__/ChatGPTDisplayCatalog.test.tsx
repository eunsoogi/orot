import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { providerFailure, providerSuccess } from '@orot/model-runtime';
import { getGenericPassword, setGenericPassword } from 'react-native-keychain';
import {
  chatGPTCredentialMutation,
  readChatGPTConsentCredential,
} from '../../chatGPTConsentIdentity';
import ProviderSelectionFlow from '../ProviderSelectionFlow';
import type { ChatGPTSelectionServices } from '../chatGPTServices';
import { createAppleSelectionOption } from '../options';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock('../../chatGPTConsentIdentity', () => ({
  chatGPTCredentialMutation: { subscribe: jest.fn(), capture: jest.fn() },
  readChatGPTConsentCredential: jest.fn(),
}));

test('reopens the checked saved ChatGPT catalog without refreshing or selecting a different provider', async () => {
  const ownerID = 'synthetic-owner';
  const modelId = 'synthetic-plan-model';
  const providerId = `chatgpt-plan:${ownerID}:${modelId}`;
  const modelName = 'Saved synthetic model';
  const account = (issuedClientID: string) => ({
    issuedClientID,
    requiresSignIn: false,
    hasDirectPlanAccess: true,
  });
  const other = account('other-synthetic-owner');
  const listAccounts = jest.fn(async () => [other, account(ownerID)]);
  const listModels = jest
    .fn()
    .mockResolvedValue(
      providerSuccess([
        { id: providerId, slug: modelId, displayName: modelName },
      ]),
    );
  const services: ChatGPTSelectionServices = {
    listAccounts,
    listModels,
    signIn: jest.fn(),
    signOut: jest.fn(),
    cancelSignIn: jest.fn(),
  };
  const selectionStore = {
    load: jest.fn(async () => ({ providerId, modelId })),
    save: jest.fn(),
    clear: jest.fn(),
  };
  const loadAppleOption = async () => createAppleSelectionOption('available');
  const files = new Map<string, { username: string; password: string }>();
  jest.mocked(getGenericPassword).mockImplementation(async options => {
    const service = options?.service ?? '';
    const item = files.get(service);
    return item ? { ...item, service, storage: 'keychain' as never } : false;
  });
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (username, password, options) => {
      const service = options?.service ?? '';
      files.set(service, { username, password });
      return { service, storage: 'keychain' as never };
    });
  const listeners = new Set<() => void>();
  jest
    .mocked(chatGPTCredentialMutation.subscribe)
    .mockImplementation(listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });
  let epoch = 'synthetic-epoch';
  jest.mocked(readChatGPTConsentCredential).mockImplementation(async () => {
    const exact = epoch;
    return {
      epoch: exact,
      isCurrent: () => epoch === exact,
      subscribe: () => () => {},
    };
  });
  const setup = (accountRefreshKey?: number) => (
    <ProviderSelectionFlow
      presentation="settings-provider"
      chatGPTServices={services}
      selectionStore={selectionStore}
      onBack={jest.fn()}
      loadAppleOption={loadAppleOption}
      accountRefreshKey={accountRefreshKey}
    />
  );
  const rows = () =>
    screen
      .getAllByRole('radio')
      .filter(row => String(row.props.testID).startsWith('provider-option-'));
  const selected = () =>
    rows().find(row => row.props.accessibilityState?.selected);
  const first = await render(setup());
  expect(screen.queryByTestId('provider-selection-current-card')).toBeNull();
  expect(
    await screen.findByTestId('settings-provider-load-models'),
  ).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByTestId('settings-provider-load-models')).toBeEnabled(),
  );
  await fireEvent.press(screen.getByTestId('settings-provider-load-models'));
  await screen.findByText(modelName);
  expect(listModels).toHaveBeenCalledWith(ownerID);
  expect(selected()).toContainElement(screen.getByText(modelName));
  await waitFor(() => expect(files.size).toBe(1));
  expect([...files.values()][0]?.password).toEqual(
    JSON.stringify({
      epoch,
      models: [{ slug: modelId, displayName: modelName }],
    }),
  );
  await first.unmount();

  const reopened = await render(setup());
  await screen.findByText(modelName);
  expect(listModels).toHaveBeenCalledTimes(1);
  expect(selected()).toContainElement(screen.getByText(modelName));
  expect(selected()).toBeDisabled();
  expect(
    screen.getAllByTestId(/^settings-provider-(connected|local)-panel$/)[0],
  ).toBe(screen.getByTestId('settings-provider-connected-panel'));

  listModels.mockResolvedValue(
    providerFailure({
      code: 'provider_unavailable',
      message: 'Transient failure',
      retryable: true,
    }),
  );
  await fireEvent.press(screen.getByTestId('settings-provider-load-models'));
  expect(selected()).toContainElement(screen.getByText(modelName));
  expect(selected()).toBeDisabled();
  expect(selectionStore.save).not.toHaveBeenCalled();

  await act(() => {
    epoch = 'new-synthetic-epoch';
    for (const listener of listeners) listener();
  });
  await waitFor(() => expect(screen.queryByText(modelName)).toBeNull());
  listAccounts.mockResolvedValue([other]);
  await reopened.rerender(setup(1));
  await waitFor(() => expect(listAccounts).toHaveBeenCalledTimes(3));
  expect(screen.queryByText(modelName)).toBeNull();
});
