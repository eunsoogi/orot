import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { navigationText } from '../src/i18n/navigation';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
} from '../src/aiFeatures/integration/featureServiceFixtures';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import type { ChatGPTSelectionServices } from '../src/providers/selection/chatGPTServices';
import { providerSuccess } from '@orot/model-runtime';
import App from '../App';
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

test('opens connected accounts as a Settings detail and returns to the Settings root', async () => {
  const store = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
      aiFeatureServiceDependencies={providerDependencies({
        listAccounts: jest.fn(async () => []),
        listModels: jest.fn() as ChatGPTSelectionServices['listModels'],
        signIn: jest.fn() as ChatGPTSelectionServices['signIn'],
        signOut: jest.fn() as ChatGPTSelectionServices['signOut'],
        cancelSignIn: jest.fn(),
      })}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  await fireEvent.press(screen.getByTestId('settings-open-accounts'));
  expect(await screen.findByTestId('settings-accounts-screen')).toBeTruthy();
  expect(await screen.findByText('연결된 계정')).toBeTruthy();
  expect(screen.getByTestId('chatgpt-account-setup')).toBeTruthy();
  expect(screen.queryByTestId('provider-option-0')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
});

test('keeps model selection and account management on separate Settings screens', async () => {
  const accountID = 'synthetic-account';
  const services: ChatGPTSelectionServices = {
    listAccounts: jest.fn().mockResolvedValue([
      {
        issuedClientID: accountID,
        requiresSignIn: false,
        hasDirectPlanAccess: true,
      },
    ]),
    listModels: jest
      .fn()
      .mockResolvedValue(
        providerSuccess([
          { slug: 'gpt-synthetic', displayName: 'GPT Synthetic' },
        ]),
      ),
    signIn: jest.fn() as ChatGPTSelectionServices['signIn'],
    signOut: jest.fn() as ChatGPTSelectionServices['signOut'],
    cancelSignIn: jest.fn(),
  };
  const appointmentStore = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => appointmentStore.repository}
      loadRecordings={async () => []}
      aiFeatureServiceDependencies={providerDependencies(
        services,
        selectionStore(null),
      )}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  await fireEvent.press(screen.getByTestId('settings-open-provider'));
  expect(await screen.findByTestId('settings-provider-screen')).toBeTruthy();
  expect(screen.getByTestId('provider-option-0')).toBeTruthy();
  expect(screen.getByTestId('settings-provider-load-models')).toBeTruthy();
  expect(screen.queryByTestId('chatgpt-account-action')).toBeNull();
  expect(screen.queryByTestId('chatgpt-account-sign-out')).toBeNull();

  await fireEvent.press(screen.getByTestId('settings-provider-load-models'));
  await waitFor(() =>
    expect(services.listModels).toHaveBeenCalledWith(accountID),
  );
  expect(screen.getByText('GPT Synthetic')).toBeTruthy();
  expect(services.signIn).not.toHaveBeenCalled();
  expect(services.signOut).not.toHaveBeenCalled();

  await fireEvent.press(
    screen.getByTestId('settings-provider-manage-accounts'),
  );
  expect(await screen.findByTestId('settings-accounts-screen')).toBeTruthy();
  expect(screen.queryByTestId('provider-option-0')).toBeNull();
  expect(screen.queryByTestId('settings-provider-load-models')).toBeNull();
  expect(screen.getByTestId('chatgpt-account-sign-out')).toBeTruthy();
});

test('keeps sign-in on the Settings account detail until shared Back is confirmed', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let resolveSignIn!: (
    result: Awaited<ReturnType<ChatGPTSelectionServices['signIn']>>,
  ) => void;
  const signIn = jest.fn(
    () =>
      new Promise<Awaited<ReturnType<ChatGPTSelectionServices['signIn']>>>(
        resolve => {
          resolveSignIn = resolve;
        },
      ),
  );
  const signInResult = {
    issuedClientID: 'synthetic-account',
    requiresSignIn: true,
    hasDirectPlanAccess: false,
  };
  const cancelSignIn = jest.fn(() => resolveSignIn(signInResult));
  const chatGPTServices: ChatGPTSelectionServices = {
    listAccounts: jest.fn(async () => []),
    listModels: jest.fn() as ChatGPTSelectionServices['listModels'],
    signIn,
    signOut: jest.fn() as ChatGPTSelectionServices['signOut'],
    cancelSignIn,
  };
  const store = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
      aiFeatureServiceDependencies={providerDependencies(chatGPTServices)}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  await fireEvent.press(screen.getByTestId('settings-open-accounts'));
  expect(screen.getByText('연결된 계정')).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByTestId('chatgpt-account-action')).toBeEnabled(),
  );
  const signInPress = fireEvent.press(
    screen.getByTestId('chatgpt-account-action'),
  );
  await waitFor(() =>
    expect(screen.getByTestId('chatgpt-cancel-sign-in')).toBeTruthy(),
  );

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(
    navigationText.leaveAccountConnection.title,
  );
  await pressAlertButton(alert, 0);
  expect(screen.getByTestId('chatgpt-cancel-sign-in')).toBeTruthy();
  expect(cancelSignIn).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  await pressAlertButton(alert, 1);
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
  expect(cancelSignIn).toHaveBeenCalledTimes(1);
  await signInPress;
});

function providerDependencies(
  chatGPTServices: ChatGPTSelectionServices,
  store = selectionStore(null),
): AiFeatureServiceDependencies {
  return {
    selectedAi: {
      selectionStore: store,
      chatGPTServices,
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => localData([memoryRecord(1)]).data,
  };
}

async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
