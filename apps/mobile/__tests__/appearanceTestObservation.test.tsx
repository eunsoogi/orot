import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import {
  AppState,
  DeviceEventEmitter,
  NativeModules,
  Text,
  useColorScheme,
  type AppStateStatus,
} from 'react-native';
import { AppearanceTestObservation } from '../e2e/AppearanceTestObservation';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const refreshAppearance = jest.fn();
let onState: (state: AppStateStatus) => void;
const remove = jest.fn();
beforeEach(() => {
  refreshAppearance
    .mockReset()
    .mockResolvedValue({ windowStyle: 1, overrideStyle: 0 });
  NativeModules.OrotTestControl = {
    refreshAppearance,
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      onState = callback;
      return { remove };
    });
  jest.mocked(useColorScheme).mockReturnValue('light');
  remove.mockClear();
});
afterEach(() => jest.restoreAllMocks());

test('reports the application subscription and preserves unknown state instead of copying the requested device mode', async () => {
  const appearance = jest.mocked(useColorScheme);
  const content = () => (
    <AppearanceTestObservation>
      <Text testID="unchanged-content">Application content</Text>
    </AppearanceTestObservation>
  );
  appearance.mockReturnValue('light');
  const view = await render(content());
  expect(screen.getByTestId('unchanged-content').props.children).toBe(
    'Application content',
  );
  const observed = () =>
    screen.getByTestId('application-appearance-observation').props
      .accessibilityLabel;
  expect(observed()).toBe('light');
  appearance.mockReturnValue('dark');
  await view.rerender(content());
  expect(observed()).toBe('dark');
  appearance.mockReturnValue(null);
  await view.rerender(content());
  expect(observed()).toBe('unspecified');
});

test('refreshes from UIKit on foreground without remounting content or replacing the observed scheme', async () => {
  const mounted = jest.fn();
  function Content() {
    useEffect(() => {
      mounted();
    }, []);
    return <Text testID="content">Retained content</Text>;
  }
  const view = await render(
    <AppearanceTestObservation>
      <Content />
    </AppearanceTestObservation>,
  );
  await waitFor(() => expect(refreshAppearance).toHaveBeenCalledTimes(1));
  const read = () =>
    JSON.parse(
      screen.getByTestId('application-appearance-refresh').props
        .accessibilityLabel,
    );
  await waitFor(() => expect(read().count).toBe(1));
  await act(() => onState('background'));
  expect(refreshAppearance).toHaveBeenCalledTimes(1);
  refreshAppearance.mockResolvedValueOnce({ windowStyle: 2, overrideStyle: 0 });
  await act(() => onState('active'));
  await waitFor(() =>
    expect(read()).toEqual({
      windowStyle: 2,
      overrideStyle: 0,
      status: 'refreshed',
      count: 2,
      applicationScheme: 'light',
    }),
  );
  // The diagnostic native value cannot make the independent application subscription pass.
  expect(
    screen.getByTestId('application-appearance-observation').props
      .accessibilityLabel,
  ).toBe('light');
  expect(screen.getByTestId('content').props.children).toBe('Retained content');
  expect(mounted).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('acknowledges native reapplication without substituting its value for the actual appearance hook', async () => {
  const view = await render(
    <AppearanceTestObservation>
      <Text>Content</Text>
    </AppearanceTestObservation>,
  );
  await waitFor(() => expect(refreshAppearance).toHaveBeenCalledTimes(1));
  await act(() =>
    DeviceEventEmitter.emit('appearanceRefreshed', {
      windowStyle: 2,
      overrideStyle: 2,
      appliedCount: 1,
      command: 'dark',
    }),
  );
  expect(
    JSON.parse(
      screen.getByTestId('application-appearance-refresh').props
        .accessibilityLabel,
    ),
  ).toMatchObject({
    windowStyle: 2,
    overrideStyle: 2,
    appliedCount: 1,
    command: 'dark',
    status: 'refreshed',
    count: 2,
  });
  expect(
    screen.getByTestId('application-appearance-observation').props
      .accessibilityLabel,
  ).toBe('light');
  await view.unmount();
  expect(NativeModules.OrotTestControl.removeListeners).toHaveBeenCalledWith(1);
});

test('preserves refresh failures instead of reporting a successful application theme', async () => {
  refreshAppearance.mockRejectedValueOnce(new Error('No foreground window'));
  await render(
    <AppearanceTestObservation>
      <Text>Content</Text>
    </AppearanceTestObservation>,
  );
  await waitFor(() =>
    expect(
      JSON.parse(
        screen.getByTestId('application-appearance-refresh').props
          .accessibilityLabel,
      ),
    ).toEqual({
      status: 'failed',
      count: 0,
      error: 'Error: No foreground window',
      applicationScheme: 'light',
    }),
  );
  expect(
    screen.getByTestId('application-appearance-observation').props
      .accessibilityLabel,
  ).toBe('light');
});

test('publishes the independent application scheme with the same native acknowledgement snapshot', async () => {
  const view = await render(<AppearanceTestObservation />);
  const read = () =>
    JSON.parse(
      screen.getByTestId('application-appearance-refresh').props
        .accessibilityLabel,
    );
  await waitFor(() => expect(read().count).toBe(1));
  await act(() =>
    DeviceEventEmitter.emit('appearanceRefreshed', {
      session: 'owned-session',
      command: 'dark',
      appliedCount: 1,
      windowStyle: 2,
      overrideStyle: 2,
      originalOverrideStyle: 0,
      applicationScheme: 'dark',
    }),
  );
  // A native payload cannot impersonate the independent hook, even if its field name collides.
  expect(read()).toMatchObject({
    applicationScheme: 'light',
    windowStyle: 2,
    appliedCount: 1,
    session: 'owned-session',
    count: 2,
  });
  jest.mocked(useColorScheme).mockReturnValue('dark');
  await view.rerender(<AppearanceTestObservation />);
  expect(read()).toMatchObject({
    applicationScheme: 'dark',
    appliedCount: 1,
    count: 2,
  });
  jest.mocked(useColorScheme).mockReturnValue(null);
  await view.rerender(<AppearanceTestObservation />);
  expect(read()).toMatchObject({
    applicationScheme: 'unspecified',
    appliedCount: 1,
    count: 2,
  });
});
