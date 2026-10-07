import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import SafeAreaLayout from '../SafeAreaLayout';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');

  return {
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
  expect(scroll.props.contentContainerStyle).toMatchObject({ flexGrow: 1 });
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(getByTestId('route-content')).toBeVisible();
});
