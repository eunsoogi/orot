import { act, render, screen } from '@testing-library/react-native';
import { useContext } from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import {
  NavigationMotionContext,
  useNavigationReduceMotion,
} from '../NavigationMotionContext';

function MotionStateLabel() {
  const enabled = useContext(NavigationMotionContext);
  return <Text>{enabled ? 'Reduce Motion on' : 'Reduce Motion off'}</Text>;
}

function MotionStateHarness() {
  const enabled = useNavigationReduceMotion();
  return (
    <NavigationMotionContext.Provider value={enabled}>
      <MotionStateLabel />
    </NavigationMotionContext.Provider>
  );
}

test('a settings change wins over a late initial read and removes its listener', async () => {
  let resolveInitialRead: (enabled: boolean) => void = () => undefined;
  const initialRead = new Promise<boolean>(resolve => {
    resolveInitialRead = resolve;
  });
  const removeListener = jest.fn();
  const addEventListener = jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove: removeListener });
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockReturnValue(initialRead);

  const view = await render(<MotionStateHarness />);
  expect(screen.getByText('Reduce Motion off')).toBeTruthy();
  expect(addEventListener).toHaveBeenCalledWith(
    'reduceMotionChanged',
    expect.any(Function),
  );
  const onChange = addEventListener.mock.calls[0]?.[1] as
    ((enabled: boolean) => void) | undefined;
  if (!onChange) throw new Error('Reduce Motion listener was not registered.');

  await act(async () => onChange(true));
  expect(screen.getByText('Reduce Motion on')).toBeTruthy();

  await act(async () => {
    resolveInitialRead(false);
    await initialRead;
  });
  expect(screen.getByText('Reduce Motion on')).toBeTruthy();

  await view.unmount();
  expect(removeListener).toHaveBeenCalledTimes(1);
});

afterEach(() => {
  jest.restoreAllMocks();
});
