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
  selectionStore,
} from '../src/aiFeatures/integration/featureServiceFixtures';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
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

test('updates the Settings provider summary after a committed selection', async () => {
  const store = selectionStore(null);
  const dependencies: AiFeatureServiceDependencies = {
    selectedAi: {
      selectionStore: store,
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

  await waitFor(() =>
    expect(screen.getByText(apple.provider.displayName)).toBeTruthy(),
  );
  expect(screen.getByText(apple.provider.displayName)).toBeTruthy();
});
