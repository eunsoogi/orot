import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { RouteLoadError } from '../RouteLoadError';

test('keeps route-opening errors readable and invokes the owning retry action', async () => {
  const onRetry = jest.fn();
  await render(
    <RouteLoadError
      title="Health records"
      message="The health records could not be opened."
      onRetry={onRetry}
    />,
  );

  const content = screen.getByTestId('route-load-error-content');
  expect(StyleSheet.flatten(content.props.style)).toMatchObject({
    alignSelf: 'center',
    maxWidth: 640,
    width: '100%',
  });
  expect(screen.getByText('Health records').props.accessibilityRole).toBe(
    'header',
  );
  expect(
    screen.getByText('The health records could not be opened.').props
      .accessibilityRole,
  ).toBe('alert');

  await fireEvent.press(screen.getByTestId('route-load-retry'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
