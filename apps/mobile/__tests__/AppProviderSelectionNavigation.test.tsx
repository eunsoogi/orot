import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import type { ComponentProps } from 'react';
import type { ChatGPTSelectionServices } from '../src/providers/selection/chatGPTServices';
import { navigationText } from '../src/i18n/navigation';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
} from '../src/aiFeatures/integration/featureServiceFixtures';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import App from '../App';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

// Route behavior is tested with native storage unopened and deterministic safe-area insets.
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

async function renderApp(props: ComponentProps<typeof App> = {}) {
  const appointmentStore = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => appointmentStore.repository}
      loadRecordings={async () => []}
      {...props}
    />,
  );
}

async function openProviderSettings() {
  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('settings-open-provider'));
}

test('routes Settings provider controls through shared Back and edge swipe', async () => {
  await renderApp();
  await openProviderSettings();
  await waitFor(() =>
    expect(screen.getByTestId('provider-selection-screen')).toBeTruthy(),
  );
  expect(screen.getByTestId('navigation-back')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );

  await fireEvent.press(screen.getByTestId('settings-open-provider'));
  await waitFor(() =>
    expect(screen.getByTestId('provider-selection-screen')).toBeTruthy(),
  );
  await performEdgeSwipe(screen.getByTestId('edge-swipe-back-region'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
});

test('updates the Settings provider summary after a committed selection', async () => {
  const store = selectionStore(null);
  await renderApp({
    aiFeatureServiceDependencies: providerDependencies(store),
  });

  await openProviderSettings();
  await waitFor(() =>
    expect(screen.getByTestId('provider-option-0')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));

  await waitFor(() =>
    expect(screen.getByText(apple.provider.displayName)).toBeTruthy(),
  );
});

test('guards a pending provider choice through button and edge-swipe back', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const store = selectionStore(null);
  await renderApp({
    aiFeatureServiceDependencies: providerDependencies(store),
  });

  await openProviderSettings();
  await waitFor(() =>
    expect(screen.getByTestId('provider-option-0')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  await waitFor(() =>
    expect(screen.getByTestId('provider-selection-confirm')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(navigationText.leaveUnsaved.title);
  await pressAlertButton(alert, 0);
  expect(screen.getByTestId('provider-selection-screen')).toBeTruthy();
  expect(store.save).not.toHaveBeenCalled();

  await performEdgeSwipe(screen.getByTestId('edge-swipe-back-region'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  await pressAlertButton(alert, 1);
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
  expect(store.save).not.toHaveBeenCalled();
});

function providerDependencies(
  store = selectionStore(null),
  chatGPTServices?: ChatGPTSelectionServices,
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

function createPanEvent(
  timestamp: number,
  previousX: number,
  currentX: number,
) {
  return {
    nativeEvent: { pageX: currentX, touches: [{}] },
    touchHistory: {
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: timestamp,
      numberActiveTouches: 1,
      touchBank: [
        {
          currentPageX: currentX,
          currentPageY: 20,
          currentTimeStamp: timestamp,
          previousPageX: previousX,
          previousPageY: 20,
          touchActive: true,
        },
      ],
    },
  } as never;
}

async function performEdgeSwipe(
  edgeRegion: ReturnType<typeof screen.getByTestId>,
) {
  const start = createPanEvent(1, 12, 12);
  const claim = createPanEvent(2, 12, 42);
  const release = createPanEvent(3, 42, 87);
  await act(async () => {
    edgeRegion.props.onStartShouldSetResponderCapture?.(start);
    edgeRegion.props.onMoveShouldSetResponderCapture?.(claim);
    edgeRegion.props.onResponderGrant?.(claim);
    edgeRegion.props.onResponderMove?.(release);
    edgeRegion.props.onResponderRelease?.(release);
    await Promise.resolve();
  });
}
