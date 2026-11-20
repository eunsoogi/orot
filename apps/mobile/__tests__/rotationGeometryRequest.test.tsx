import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { RotationGeometryRequest } from '../e2e/RotationGeometryRequest';

test('only the synthetic resize target moves to a safe trailing header slot', async () => {
  const view = await render(<RotationGeometryRequest session="synthetic" />);
  const normal = view.getByTestId('rotation-transition-request');
  expect(StyleSheet.flatten(normal.props.style)).toMatchObject({
    top: 0,
    left: '50%',
    width: 44,
    height: 44,
  });
  expect(
    view.queryByTestId('synthetic-safe-rotation-transition-request'),
  ).toBeNull();

  await view.rerender(
    <RotationGeometryRequest
      session="synthetic"
      syntheticTransitionInsets={{ top: 0, right: 84 }}
    />,
  );
  const scoped = view.getByTestId('synthetic-safe-rotation-transition-request');
  expect(StyleSheet.flatten(scoped.props.style)).toMatchObject({
    top: 72,
    right: 92,
    width: 44,
    height: 44,
  });
  expect(StyleSheet.flatten(scoped.props.style).left).toBeUndefined();
  expect(view.queryByTestId('rotation-transition-request')).toBeNull();
  expect(view.getByTestId('rotation-geometry-request')).toBeTruthy();

  await view.rerender(
    <RotationGeometryRequest
      session="synthetic"
      syntheticTransitionInsets={{ top: 80, right: 0 }}
    />,
  );
  expect(
    StyleSheet.flatten(
      view.getByTestId('synthetic-safe-rotation-transition-request').props
        .style,
    ),
  ).toMatchObject({
    top: 88,
    right: 12,
    width: 44,
    height: 44,
  });
});
