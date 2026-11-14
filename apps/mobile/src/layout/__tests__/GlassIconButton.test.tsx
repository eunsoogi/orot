import { fireEvent, render, screen } from '@testing-library/react-native';
import { GlassIconButton } from '../GlassIconButton';

test('bridges native activation, label, hint and busy state without a passive material overlay', async () => {
  const onPress = jest.fn();
  const view = await render(
    <GlassIconButton
      symbolName="waveform"
      accessibilityLabel="음성"
      accessibilityHint="음성 대화 시작"
      accessibilityState={{ busy: true }}
      onPress={onPress}
      testID="native-action"
      style={{ width: 64, height: 64, borderRadius: 32, overflow: 'hidden' }}
    />,
  );
  let action = screen.getByTestId('native-action');
  expect(action.props).toMatchObject({
    symbolName: 'waveform',
    actionLabel: '음성',
    actionHint: '음성 대화 시작',
    busy: true,
    disabled: false,
  });
  expect(action).toHaveStyle({
    width: 64,
    height: 64,
    borderRadius: 0,
    overflow: 'visible',
  });
  // Direct native event, not the adapter's simulated press, verifies the production bridge callback.
  await fireEvent(action, 'action');
  expect(onPress).toHaveBeenCalledTimes(1);
  await view.rerender(
    <GlassIconButton
      symbolName="waveform"
      accessibilityLabel="음성"
      disabled
      onPress={onPress}
      testID="native-action"
    />,
  );
  action = screen.getByTestId('native-action');
  await fireEvent(action, 'action');
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(action.props.disabled).toBe(true);
});
