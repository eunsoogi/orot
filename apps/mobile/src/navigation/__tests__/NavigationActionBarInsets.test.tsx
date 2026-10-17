import { render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { NavigationActionBar } from '../NavigationActionBar';
import { createNavigationController } from '../navigationController';

let mockBottomInset = 0;

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

  return {
    useSafeAreaInsets: () => ({
      top: 0,
      right: 0,
      bottom: mockBottomInset,
      left: 0,
    }),
    SafeAreaView: ({
      children,
      style,
      testID,
    }: {
      children?: ReactNode;
      style?: object;
      testID?: string;
    }) => React.createElement(NativeView, { style, testID }, children),
  };
});

function FallbackSurface({
  children,
  testID,
}: {
  children: ReactNode;
  testID: string;
}) {
  return <View testID={testID}>{children}</View>;
}

beforeEach(() => {
  mockBottomInset = 0;
});

it.each([
  { bottomInset: 0, expectedTranslation: 0 },
  { bottomInset: 34, expectedTranslation: 10 },
])(
  'limits root-tab overlap to the available inset (%p)',
  async ({ bottomInset, expectedTranslation }) => {
    mockBottomInset = bottomInset;
    const controller = createNavigationController<'home'>('home');
    await render(
      <NavigationActionBar
        controller={controller}
        rootTabs={{ activeTab: 'home', onSelect: jest.fn() }}
        surface={FallbackSurface}
      />,
    );

    const offsetContainer = screen.getByTestId(
      'navigation-bar-fallback',
    ).parent;
    expect(offsetContainer).not.toBeNull();
    expect(StyleSheet.flatten(offsetContainer!.props.style).transform).toEqual([
      { translateY: expectedTranslation },
    ]);
  },
);

it('does not reclaim the bottom inset while the keyboard is visible', async () => {
  mockBottomInset = 34;
  const controller = createNavigationController<'home'>('home');
  await render(
    <NavigationActionBar
      controller={controller}
      rootTabs={{ activeTab: 'home', onSelect: jest.fn() }}
      keyboardVisible
      surface={FallbackSurface}
    />,
  );

  const offsetContainer = screen.getByTestId('navigation-bar-fallback').parent;
  expect(offsetContainer).not.toBeNull();
  expect(StyleSheet.flatten(offsetContainer!.props.style)).toBeUndefined();
});
