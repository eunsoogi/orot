import { act, render, screen } from '@testing-library/react-native';
import { AppState, NativeModules, Text } from 'react-native';
import { ReminderTestObservation } from '../e2e/ReminderTestObservation';

const snapshot = jest.fn();
const initialState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  NativeModules.OrotReminderTestObservation = { snapshot };
  snapshot.mockReset();
});

afterEach(() => {
  delete NativeModules.OrotReminderTestObservation;
  AppState.currentState = initialState;
  jest.useRealTimers();
});

it('keeps the real child tree and stops OS observations after unmount', async () => {
  snapshot.mockResolvedValue({
    status: 'observed',
    authorization: 0,
    pending: [],
  });
  const view = await render(
    <ReminderTestObservation>
      <Text>Real application tree</Text>
    </ReminderTestObservation>,
  );
  await act(async () => {});
  expect(screen.getByText('Real application tree')).toBeTruthy();
  expect(snapshot).toHaveBeenCalledTimes(1);
  await view.unmount();
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(snapshot).toHaveBeenCalledTimes(1);
});

it('reports an unavailable native observation instead of inventing OS success', async () => {
  snapshot.mockRejectedValue(new Error('Synthetic observation failure'));
  await render(
    <ReminderTestObservation>
      <Text>Real application tree</Text>
    </ReminderTestObservation>,
  );
  await act(async () => {});
  const receipt = JSON.parse(
    screen.getByTestId('reminder-os-observation').props.accessibilityLabel,
  );
  expect(receipt).toEqual({
    status: 'failed',
    code: 'os-observation-unavailable',
  });
});
