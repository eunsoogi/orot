import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppText } from '../../layout/AppText';
import { AssistantAppearanceProvider } from '../AssistantAppearanceProvider';
import type { AssistantAppearance } from '../appearance';
import { appearanceStore } from '../appearanceStore';

jest.unmock('../../appEntry/useStartupMinimumDisplay');
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaProvider: View,
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

const title = '일반 화면';
const configured: AssistantAppearance = { avatar: 'neutral', name: null };
const load = jest.mocked(appearanceStore.load);

const enter = jest.fn();
function Entry() {
  useEffect(() => {
    enter();
  }, []);
  return <AppText>{title}</AppText>;
}
const tree = (
  <AssistantAppearanceProvider>
    <Entry />
  </AssistantAppearanceProvider>
);

function stagedAppearance() {
  let complete!: (value: AssistantAppearance) => void;
  const preference = new Promise<AssistantAppearance>(resolve => {
    complete = resolve;
  });
  return { preference, complete };
}

beforeEach(() => {
  jest.useFakeTimers();
  load.mockReset();
  enter.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const tick = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

test('fast success retains the startup surface through 1999 ms and opens the app at 2000 ms', async () => {
  load.mockResolvedValue(configured);
  await render(tree);
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('startup-surface')).toBeVisible();
  expect(screen.queryByText(title)).toBeNull();
  await tick(1999);
  expect(screen.getByTestId('startup-surface')).toBeVisible();
  expect(screen.queryByText(title)).toBeNull();
  expect(enter).not.toHaveBeenCalled();
  await tick(1);
  expect(screen.queryByTestId('startup-surface')).toBeNull();
  expect(screen.getByText(title)).toBeVisible();
  expect(enter).toHaveBeenCalledTimes(1);
});

test('startup that needs longer stays loading and opens immediately when ready', async () => {
  const pending = stagedAppearance();
  load.mockReturnValue(pending.preference);
  await render(tree);
  await tick(2_700);
  expect(screen.getByTestId('startup-surface')).toBeVisible();
  expect(screen.queryByText(title)).toBeNull();
  await act(() => pending.complete(configured));
  expect(screen.queryByTestId('startup-surface')).toBeNull();
  expect(screen.getByText(title)).toBeVisible();
  expect(enter).toHaveBeenCalledTimes(1);
});

test('failure displays immediately and a user retry does not restart the startup minimum', async () => {
  load
    .mockRejectedValueOnce(new Error('preferences'))
    .mockResolvedValueOnce(configured);
  await render(tree);
  expect(screen.queryByTestId('startup-surface')).toBeNull();
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.queryByText(title)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(title)).toBeVisible();
  expect(enter).toHaveBeenCalledTimes(1);
});

test('unmount cancels the pending minimum and never enters the later-ready app', async () => {
  const pending = stagedAppearance();
  load.mockReturnValue(pending.preference);
  const set = jest.spyOn(globalThis, 'setTimeout');
  const clear = jest.spyOn(globalThis, 'clearTimeout');
  const ui = await render(tree);
  const index = set.mock.calls.findIndex(call => call[1] === 2_000);
  expect(index).toBeGreaterThanOrEqual(0);
  const timer = set.mock.results[index]?.value;
  await ui.unmount();
  expect(clear).toHaveBeenCalledWith(timer);
  await act(() => pending.complete(configured));
  await tick(2_500);
  expect(screen.queryByText(title)).toBeNull();
  expect(enter).not.toHaveBeenCalled();
});
