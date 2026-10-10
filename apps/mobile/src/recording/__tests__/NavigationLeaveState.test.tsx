import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { confirmNavigationLeave } from '../../navigation/navigationLeaveConfirmation';
import type { NavigationLeaveState } from '../../navigation/navigationLeaveGuard';
import {
  createNavigationController,
  NavigationRouteAdapter,
  NavigationLeaveStateRegistrationProvider,
  type NavigationLeaveStateRegistration,
} from '../../navigation';
import type { NavigationSurfaceProps } from '../../navigation/NavigationActionBar';
import RecordingScreen from '../RecordingScreen';
import {
  completed,
  createService,
  savedSource,
} from '../recordingScreenSupport';
import type {
  CompletedRecording,
  RecordingSourceRecord,
} from '../recordingTypes';

jest.mock('../../navigation/navigationLeaveConfirmation', () => ({
  confirmNavigationLeave: jest.fn(async () => true),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

  return {
    SafeAreaInsetsContext: React.createContext(null),
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({
      children,
      testID,
    }: {
      children?: ReactNode;
      testID?: string;
    }) => React.createElement(NativeView, { testID }, children),
  };
});

jest.mock('../nativeRecordingBridge', () => ({
  nativeRecordingBridge: {},
  isSyntheticRecordingProbeAvailable: jest.fn(() => false),
  prepareSyntheticRecordingProbe: jest.fn(),
  simulateRecordingInterruption: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

type TestRoute = 'home' | 'recording';

function TestSurface({ children }: NavigationSurfaceProps) {
  return <View>{children}</View>;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderRecordingNavigation(
  controller: ReturnType<typeof createNavigationController<TestRoute>>,
  service: ReturnType<typeof createService>['service'],
) {
  return await render(
    <NavigationRouteAdapter controller={controller} surface={TestSurface}>
      {({ route }) =>
        route.name === 'recording' ? (
          <RecordingScreen onBack={jest.fn()} service={service} />
        ) : (
          <Text testID="home-route">Home</Text>
        )
      }
    </NavigationRouteAdapter>,
  );
}

async function startRecording(rendered: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(rendered.getByTestId('recording-consent'));
  await fireEvent.press(rendered.getByTestId('recording-start'));
  rendered.getByText('녹음 중');
}

test('registers active recording with its stop-and-save action', async () => {
  let registered:
    | {
        readState: () => NavigationLeaveState;
        stopRecording?: () => Promise<void>;
      }
    | undefined;
  const registerLeaveState: NavigationLeaveStateRegistration = source => {
    registered = source;
    return () => {};
  };
  const { service } = createService();
  await render(
    <NavigationLeaveStateRegistrationProvider
      registerLeaveState={registerLeaveState}
    >
      <RecordingScreen onBack={jest.fn()} service={service} />
    </NavigationLeaveStateRegistrationProvider>,
  );

  await screen.findByTestId('recording-status');
  const source = registered;
  if (!source) throw new Error('Leave state was not registered.');
  const readState = () => {
    return source.readState();
  };
  expect(readState()).toMatchObject({ canLeave: true, isRecording: false });
  expect(screen.queryByTestId('recording-back')).toBeNull();

  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));
  expect(await screen.findByTestId('recording-status')).toHaveTextContent(
    '녹음 중',
  );
  expect(readState()).toMatchObject({ canLeave: true, isRecording: true });

  expect(source.stopRecording).toEqual(expect.any(Function));
});

test('leaves after an approved back waits for the committed stop-and-save state', async () => {
  const controller = createNavigationController<TestRoute>('home');
  controller.push('recording');
  const { service } = createService();
  const stop = createDeferred<CompletedRecording>();
  const save = createDeferred<RecordingSourceRecord>();
  jest.spyOn(service, 'stop').mockImplementation(() => stop.promise);
  jest.spyOn(service, 'saveSource').mockImplementation(() => save.promise);

  const rendered = await renderRecordingNavigation(controller, service);
  rendered.getByTestId('recording-status');
  await startRecording(rendered);

  let leaveRequest!: Promise<boolean>;
  await act(async () => {
    leaveRequest = controller.requestBack();
    await Promise.resolve();
  });
  expect(confirmNavigationLeave).toHaveBeenCalledWith(
    expect.objectContaining({ reasons: ['recording'] }),
  );
  expect(service.stop).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().currentRoute.name).toBe('recording');

  await act(async () => {
    stop.resolve(completed);
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(service.saveSource).toHaveBeenCalledWith(completed),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe('recording');

  await act(async () => {
    save.resolve(savedSource);
    await Promise.resolve();
  });
  await expect(leaveRequest).resolves.toBe(true);

  expect(controller.getSnapshot().currentRoute.name).toBe('home');
  expect(rendered.getByTestId('home-route')).toBeVisible();
});

test('keeps the recording route when protected-source save fails', async () => {
  const controller = createNavigationController<TestRoute>('home');
  controller.push('recording');
  const { service } = createService();
  const save = createDeferred<RecordingSourceRecord>();
  jest.spyOn(service, 'saveSource').mockImplementation(() => save.promise);

  const rendered = await renderRecordingNavigation(controller, service);
  rendered.getByTestId('recording-status');
  await startRecording(rendered);

  let leaveRequest!: Promise<boolean>;
  await act(async () => {
    leaveRequest = controller.requestBack();
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(service.saveSource).toHaveBeenCalledWith(completed),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe('recording');

  await act(async () => {
    save.reject(new Error('source save failed'));
    await Promise.resolve();
  });
  await expect(leaveRequest).resolves.toBe(false);

  expect(controller.getSnapshot().currentRoute.name).toBe('recording');
  expect(rendered.getByText('녹음 저장됨')).toBeVisible();
});
