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
  expect(await screen.findByText('연결된 계정')).toBeTruthy();
  expect(screen.getByTestId('chatgpt-account-setup')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
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

async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
