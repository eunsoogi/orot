import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationGlassAction } from '../../ragConversation/ConversationGlassAction';
import { AppSymbol } from '../AppSymbol';
import { appColors } from '../appColors';

jest.mock('react-native', () => {
  const React = require('react');
  const ReactNative = jest.requireActual('react-native');
  const NativeSymbol = (props: Record<string, unknown>) =>
    React.createElement(ReactNative.View, {
      ...props,
      testID: 'native-app-symbol',
    });
  const mockedReactNative = Object.create(ReactNative);
  Object.defineProperty(mockedReactNative, 'requireNativeComponent', {
    value: () => NativeSymbol,
  });
  Object.defineProperty(mockedReactNative, 'Platform', {
    value: { ...ReactNative.Platform, OS: 'android' },
  });
  return mockedReactNative;
});

test('uses the shared compact size and restrained accent for body symbols', async () => {
  const view = await render(<AppSymbol name="sparkles" />);
  const symbol = view.getByTestId('native-app-symbol', {
    includeHiddenElements: true,
  });

  expect(symbol.props.pointSize).toBe(18);
  expect(StyleSheet.flatten(symbol.props.style)).toMatchObject({
    width: 18,
    height: 18,
  });
  expect(symbol.props.tintColor).toBe(appColors.primary);
  expect(symbol.props.accessibilityElementsHidden).toBe(true);
  expect(symbol.props.importantForAccessibility).toBe('no-hide-descendants');
});

test('keeps the composer fallback symbol on the shared compact scale', async () => {
  const view = await render(
    <ConversationGlassAction
      busy={false}
      disabled={false}
      label="Send"
      onPress={jest.fn()}
    />,
  );
  const symbol = view.getByTestId('native-app-symbol', {
    includeHiddenElements: true,
  });

  expect(symbol.props.symbolName).toBe('arrow.up');
  expect(symbol.props.pointSize).toBe(18);
  expect(StyleSheet.flatten(symbol.props.style)).toMatchObject({
    width: 18,
    height: 18,
  });
});

test('keeps intentional caller size and semantic tint overrides', async () => {
  const view = await render(
    <AppSymbol name="mic.fill" size={52} color={appColors.onPrimary} />,
  );
  const symbol = view.getByTestId('native-app-symbol', {
    includeHiddenElements: true,
  });

  expect(symbol.props.pointSize).toBe(52);
  expect(StyleSheet.flatten(symbol.props.style)).toMatchObject({
    width: 52,
    height: 52,
  });
  expect(symbol.props.tintColor).toBe(appColors.onPrimary);
});
