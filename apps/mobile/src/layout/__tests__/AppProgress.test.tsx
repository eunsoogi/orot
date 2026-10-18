import { render } from '@testing-library/react-native';
import { AppProgress } from '../AppProgress';

it('keeps progress identity, presentation and requested animation state on the native view', async () => {
  const screen = await render(
    <AppProgress
      testID="progress"
      accessibilityLabel="Generating"
      color="#123456"
      size="large"
    />,
  );
  const indicator = screen.getByTestId('progress');
  expect(indicator.props.accessibilityLabel).toBe('Generating');
  expect(indicator.props.color).toBe('#123456');
  expect(indicator.props.large).toBe(true);
  expect(indicator.props.active).toBe(true);
  await screen.rerender(<AppProgress testID="progress" animating={false} />);
  expect(screen.getByTestId('progress').props.active).toBe(false);
  expect(screen.getByTestId('progress').props.large).toBe(false);
});
