import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { FloatingProfileGradient } from '../FloatingProfileGradient';

test('keeps the backdrop touch-transparent and reacts to transparency preference', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled')
    .mockResolvedValue(false);
  let change!: (value: boolean) => void;
  const remove = jest.fn();
  const subscription = jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((_name, callback) => {
      change = callback as (value: boolean) => void;
      return { remove };
    });
  const view = await render(<FloatingProfileGradient />);
  const backdrop = screen.getByTestId('assistant-floating-gradient', {
    includeHiddenElements: true,
  });
  expect(backdrop.props.pointerEvents).toBe('none');
  expect(backdrop.props.accessibilityElementsHidden).toBe(true);
  expect(
    screen.queryByTestId('assistant-floating-gradient-opaque', {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  await act(async () => {
    change(true);
  });
  expect(
    screen.getByTestId('assistant-floating-gradient-opaque', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  await view.unmount();
  expect(remove).toHaveBeenCalled();
  subscription.mockRestore();
  jest.restoreAllMocks();
});
