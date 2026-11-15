import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Text, StyleSheet, Keyboard } from 'react-native';
import { render } from '@testing-library/react-native';
import SafeAreaLayout from '../SafeAreaLayout';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');

  return {
    useSafeAreaInsets: () => ({ top: 0, right: 0, left: 0, bottom: 34 }),
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({
      children,
      edges,
      style,
      testID,
    }: {
      children?: ReactNode;
      edges?: readonly string[];
      style?: StyleProp<ViewStyle>;
      testID?: string;
    }) =>
      React.createElement(
        View,
        { accessibilityHint: edges?.join(','), style, testID },
        children,
      ),
  };
});

// Native Simulator assertions cover geometry; these tests guard the layout contract.
test('applies every screen edge to the route root', async () => {
  const { getByTestId } = await render(
    <SafeAreaLayout>
      <Text>Route content</Text>
    </SafeAreaLayout>,
  );

  expect(getByTestId('safe-area-root').props.accessibilityHint).toBe(
    'top,right,bottom,left',
  );
});

test('configures keyboard-aware scrolling for overflowing route content', async () => {
  const { getByTestId } = await render(
    <SafeAreaLayout scrollable>
      <Text testID="route-content">Route content</Text>
    </SafeAreaLayout>,
  );

  const scroll = getByTestId('safe-area-scroll');
  expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(getByTestId('safe-area-root').props.accessibilityHint).toBe(
    'top,right,left',
  );
  expect(scroll.props.contentInsetAdjustmentBehavior).toBe('never');
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    flexGrow: 1,
    paddingBottom: 50,
  });
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(getByTestId('route-content')).toBeVisible();
});

test.each([true, false])(
  'preserves end clearance independently of keyboard visibility (%s)',
  async visible => {
    const spy = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(visible);
    const { getByTestId } = await render(
      <SafeAreaLayout scrollable scrollContentStyle={{ padding: 24 }}>
        <Text>Editable content</Text>
      </SafeAreaLayout>,
    );
    expect(
      StyleSheet.flatten(
        getByTestId('safe-area-scroll').props.contentContainerStyle,
      ).paddingBottom,
    ).toBe(58);
    spy.mockRestore();
  },
);
