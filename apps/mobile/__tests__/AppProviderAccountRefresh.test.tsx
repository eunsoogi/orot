import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { providerSuccess } from '@orot/model-runtime';
import App from '../App';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
} from '../src/aiFeatures/integration/featureServiceFixtures';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import type { ChatGPTSelectionServices } from '../src/providers/selection/chatGPTServices';
import type { OpenAIAccountSummary } from '../src/providers/openai';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../src/providers/selection/options', () => {
  const actual = jest.requireActual('../src/providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

afterEach(() => jest.restoreAllMocks());

test('refreshes provider state after connected accounts sign in and sign out', async () => {
  const account: OpenAIAccountSummary = {
    issuedClientID: 'synthetic-account',
    requiresSignIn: false,
    hasDirectPlanAccess: true,
  };
  let linkedAccounts: OpenAIAccountSummary[] = [];
  const listAccounts = jest.fn(async () => [...linkedAccounts]);
  const services: ChatGPTSelectionServices = {
    listAccounts,
    listModels: jest.fn(async () =>
      providerSuccess([
        {
          id: 'gpt-synthetic-id',
          slug: 'gpt-synthetic',
          displayName: 'GPT Synthetic',
        },
      ]),
    ),
    signIn: jest.fn(async () => {
      linkedAccounts = [account];
      return account;
    }),
    signOut: jest.fn(async () => {
      linkedAccounts = [];
      return 'revoked';
    }),
    cancelSignIn: jest.fn(),
  };
  const appointmentStore = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => appointmentStore.repository}
      loadRecordings={async () => []}
      aiFeatureServiceDependencies={providerDependencies(services)}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  await fireEvent.press(screen.getByTestId('settings-open-provider'));
  await screen.findByTestId('settings-provider-screen');
  await fireEvent.press(
    screen.getByTestId('settings-provider-manage-accounts'),
  );
  await screen.findByTestId('settings-accounts-screen');
  await waitFor(() =>
    expect(screen.getByTestId('chatgpt-account-action')).toBeEnabled(),
  );
  await fireEvent.press(screen.getByTestId('chatgpt-account-action'));
  await screen.findByTestId('chatgpt-account-0');

  const beforeSignInReturn = listAccounts.mock.calls.length;
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await screen.findByTestId('settings-provider-screen');
  await waitFor(() =>
    expect(listAccounts).toHaveBeenCalledTimes(beforeSignInReturn + 1),
  );
  await waitFor(() =>
    expect(screen.getByTestId('settings-provider-load-models')).toBeEnabled(),
  );
  await fireEvent.press(screen.getByTestId('settings-provider-load-models'));
  await screen.findByText('GPT Synthetic');

  await fireEvent.press(
    screen.getByTestId('settings-provider-manage-accounts'),
  );
  await screen.findByTestId('settings-accounts-screen');
  await waitFor(() =>
    expect(screen.getByTestId('chatgpt-account-sign-out')).toBeEnabled(),
  );
  await fireEvent.press(screen.getByTestId('chatgpt-account-sign-out'));
  await waitFor(() =>
    expect(screen.queryByTestId('chatgpt-account-sign-out')).toBeNull(),
  );

  const beforeSignOutReturn = listAccounts.mock.calls.length;
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await screen.findByTestId('settings-provider-screen');
  await waitFor(() =>
    expect(listAccounts).toHaveBeenCalledTimes(beforeSignOutReturn + 1),
  );
  expect(screen.queryByTestId('settings-provider-load-models')).toBeNull();
  expect(screen.queryByText('GPT Synthetic')).toBeNull();
});

function providerDependencies(
  chatGPTServices: ChatGPTSelectionServices,
): AiFeatureServiceDependencies {
  return {
    selectedAi: {
      selectionStore: selectionStore(null),
      chatGPTServices,
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => localData([memoryRecord(1)]).data,
  };
}
