import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  apple,
  localData,
  memoryRecord,
} from '../src/aiFeatures/integration/featureServiceFixtures';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import { nativeChatGPTSelectionServices } from '../src/providers/selection/chatGPTServices';
import type {
  ProviderSelection,
  ProviderSelectionStore,
} from '../src/providers/selection/types';
import App from '../App';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

// Keep native routes deterministic while this test follows a committed provider choice.
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

test('retains a committed selection without a model subtitle on Settings', async () => {
  const store = persistedSelectionStore(null);
  const dependencies: AiFeatureServiceDependencies = {
    selectedAi: {
      selectionStore: store,
      chatGPTServices: {
        ...nativeChatGPTSelectionServices,
        listAccounts: async () => [],
      },
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => localData([memoryRecord(1)]).data,
  };
  const appointmentStore = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => appointmentStore.repository}
      loadRecordings={async () => []}
      aiFeatureServiceDependencies={dependencies}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  await fireEvent.press(screen.getByTestId('settings-open-provider'));
  await waitFor(() =>
    expect(screen.getByTestId('provider-option-0')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));

  await screen.findByTestId('settings-title');
  expect(screen.queryByText(apple.provider.displayName)).toBeNull();
  expect(await store.load()).toEqual({
    providerId: apple.provider.id,
    modelId: apple.modelId,
  });
  await fireEvent.press(screen.getByTestId('settings-open-provider'));
  await waitFor(() =>
    expect(
      screen.getByTestId('provider-option-0').props.accessibilityState.selected,
    ).toBe(true),
  );
});

function persistedSelectionStore(
  initial: ProviderSelection | null,
): ProviderSelectionStore {
  let current = initial;
  return {
    load: async () => current,
    save: async selection => {
      current = selection;
    },
    clear: async () => {
      current = null;
    },
  };
}
