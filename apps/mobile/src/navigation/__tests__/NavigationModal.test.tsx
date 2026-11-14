import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { NavigationModal } from '../NavigationModal';

// This mock observes only the native presentation contract, not UIKit animation.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.defineProperty(Object.create(actual), 'Modal', {
    value: (props: object) => <actual.View {...props} testID="native-modal" />,
  });
});
const read = () => screen.getByTestId('native-modal').props;
afterEach(() => jest.restoreAllMocks());
beforeEach(() => jest.clearAllMocks());

test('waits for the system preference then presents with native slide and unchanged callbacks', async () => {
  let resolve!: (enabled: boolean) => void;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(
    new Promise<boolean>(done => {
      resolve = done;
    }),
  );
  const cancel = jest.fn();
  await render(
    <NavigationModal visible onRequestClose={cancel}>
      <Text>Sheet</Text>
    </NavigationModal>,
  );
  expect(read().visible).toBe(false);
  await act(async () => resolve(false));
  expect(read().visible).toBe(true);
  expect(read().animationType).toBe('slide');
  await act(async () => read().onRequestClose());
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('Reduce Motion event wins over a stale read and hidden sheets remain hidden', async () => {
  let resolve!: (enabled: boolean) => void;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(
    new Promise<boolean>(done => {
      resolve = done;
    }),
  );
  const remove = jest.fn();
  const subscribe = jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove });
  const view = await render(
    <NavigationModal visible={false}>
      <Text>Sheet</Text>
    </NavigationModal>,
  );
  await act(async () => {
    subscribe.mock.calls[0]![1](true);
    resolve(false);
  });
  expect(read().animationType).toBe('none');
  expect(read().visible).toBe(false);
  await view.rerender(
    <NavigationModal visible>
      <Text>Sheet</Text>
    </NavigationModal>,
  );
  expect(read().visible).toBe(true);
  expect(read().animationType).toBe('none');
  await view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('setting read failure presents without motion instead of blocking dismissal', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockRejectedValue(new Error('unavailable'));
  await render(
    <NavigationModal>
      <Text>Sheet</Text>
    </NavigationModal>,
  );
  expect(read().visible).toBe(true);
  expect(read().animationType).toBe('none');
});
