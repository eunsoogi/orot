import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import App from '../App';
import { navigationText } from '../src/i18n/navigation';

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

afterEach(() => jest.restoreAllMocks());

test('routes recording from home through the shared button and edge swipe', async () => {
  await render(<App />);

  await fireEvent.press(screen.getByTestId('open-recording'));
  expect(await screen.findByRole('header', { name: '상담 녹음' })).toBeTruthy();
  expect(screen.getByTestId('navigation-back')).toBeTruthy();
  expect(screen.queryByTestId('recording-back')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(screen.getByTestId('welcome-title')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('open-recording'));
  await waitFor(() =>
    expect(screen.getByTestId('navigation-back')).toBeTruthy(),
  );
  await performEdgeSwipe(screen.getByTestId('edge-swipe-back-region'));
  await waitFor(() => expect(screen.getByTestId('welcome-title')).toBeTruthy());
});

test('uses the same unsaved-selection confirmation for button and edge swipe', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<App importHealthObservations={jest.fn()} />);

  await fireEvent.press(screen.getByTestId('open-common-observations'));
  expect(
    await screen.findByRole('header', { name: '건강 기록 가져오기' }),
  ).toBeTruthy();
  expect(screen.getByTestId('navigation-back')).toBeTruthy();
  expect(screen.queryByTestId('common-observations-back')).toBeNull();
  await fireEvent.press(screen.getByTestId('common-observations-toggle-steps'));

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(navigationText.leaveUnsaved.title);
  expect(alert.mock.calls[0]?.[1]).toBe(navigationText.leaveUnsaved.message);
  await pressAlertButton(alert, 0);
  expect(
    screen.getByTestId('common-observations-toggle-steps').props
      .accessibilityState.checked,
  ).toBe(true);

  await performEdgeSwipe(screen.getByTestId('edge-swipe-back-region'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  expect(alert.mock.calls[1]?.[0]).toBe(navigationText.leaveUnsaved.title);
  expect(alert.mock.calls[1]?.[1]).toBe(navigationText.leaveUnsaved.message);
  await pressAlertButton(alert, 1);
  await waitFor(() => expect(screen.getByTestId('welcome-title')).toBeTruthy());
});

test('routes blood pressure through the shared back action', async () => {
  await render(<App loadBloodPressureObservations={async () => []} />);

  await fireEvent.press(screen.getByTestId('open-blood-pressure-import'));
  expect(await screen.findByRole('header', { name: '혈압 기록' })).toBeTruthy();
  expect(screen.getByTestId('navigation-back')).toBeTruthy();
  expect(screen.queryByTestId('blood-pressure-back')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(screen.getByTestId('welcome-title')).toBeTruthy());
});

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
