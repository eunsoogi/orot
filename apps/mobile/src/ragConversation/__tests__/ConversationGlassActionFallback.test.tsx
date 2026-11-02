import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationGlassAction } from '../ConversationGlassAction';

jest.mock('react-native', () => {
  const React = require('react');
  const ReactNative = jest.requireActual('react-native');
  const NativeSymbol = (props: Record<string, unknown>) =>
    React.createElement(ReactNative.View, {
      ...props,
      testID: 'native-app-symbol',
    });
  const mockedReactNative = Object.create(ReactNative);
  // Select the fallback branch so the test observes the non-iOS composer control.
  Object.defineProperty(mockedReactNative, 'Platform', {
    value: { ...ReactNative.Platform, OS: 'android' },
  });
  Object.defineProperty(mockedReactNative, 'requireNativeComponent', {
    value: () => NativeSymbol,
  });
  return mockedReactNative;
});

test('uses the shared compact icon size and preserves fallback action states', async () => {
  const onPress = jest.fn();
  const view = await render(
    <ConversationGlassAction
      busy={false}
      disabled={false}
      label="Send"
      onPress={onPress}
    />,
  );
  let action = screen.getByTestId('rag-conversation-send');
  let symbol = screen.getByTestId('native-app-symbol', {
    includeHiddenElements: true,
  });
  expect(symbol.props.pointSize).toBe(18);
  expect(StyleSheet.flatten(symbol.props.style)).toMatchObject({
    width: 18,
    height: 18,
  });
  expect(StyleSheet.flatten(action.props.style)).toMatchObject({
    minWidth: 44,
    minHeight: 44,
  });
  expect(action.props.accessibilityState).toMatchObject({
    busy: false,
    disabled: false,
  });
  await fireEvent.press(action);
  expect(onPress).toHaveBeenCalledTimes(1);

  await view.rerender(
    <ConversationGlassAction
      busy
      disabled={false}
      label="Cancel"
      onPress={onPress}
    />,
  );
  action = screen.getByTestId('rag-conversation-cancel');
  symbol = screen.getByTestId('native-app-symbol', {
    includeHiddenElements: true,
  });
  expect(symbol.props.pointSize).toBe(18);
  expect(action.props.accessibilityState).toMatchObject({
    busy: true,
    disabled: false,
  });
  await fireEvent.press(action);
  expect(onPress).toHaveBeenCalledTimes(2);

  await view.rerender(
    <ConversationGlassAction
      busy={false}
      disabled
      label="Send"
      onPress={onPress}
    />,
  );
  action = screen.getByTestId('rag-conversation-send');
  expect(action.props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(action);
  expect(onPress).toHaveBeenCalledTimes(2);
});
