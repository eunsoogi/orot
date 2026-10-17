import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { NavigationActionBar } from '../NavigationActionBar';
import { createNavigationController } from '../navigationController';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

let mockBottomInset = 0;
let surfaceMountCount = 0;
let surfaceUnmountCount = 0;

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

  return {
    SafeAreaInsetsContext: React.createContext(null),
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

function withSafeAreaInsets(children: ReactNode) {
  return (
    <SafeAreaInsetsContext.Provider
      value={{ top: 0, right: 0, bottom: mockBottomInset, left: 0 }}
    >
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}

function TrackingSurface({
  children,
  testID,
}: {
  children: ReactNode;
  testID: string;
}) {
  useEffect(() => {
    surfaceMountCount += 1;
    return () => {
      surfaceUnmountCount += 1;
    };
  }, []);

  return <View testID={testID}>{children}</View>;
}

beforeEach(() => {
  mockBottomInset = 0;
  surfaceMountCount = 0;
  surfaceUnmountCount = 0;
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
      withSafeAreaInsets(
        <NavigationActionBar
          controller={controller}
          rootTabs={{ activeTab: 'home', onSelect: jest.fn() }}
          surface={FallbackSurface}
        />,
      ),
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
    withSafeAreaInsets(
      <NavigationActionBar
        controller={controller}
        rootTabs={{ activeTab: 'home', onSelect: jest.fn() }}
        keyboardVisible
        surface={FallbackSurface}
      />,
    ),
  );

  const offsetContainer = screen.getByTestId('navigation-bar-fallback').parent;
  expect(offsetContainer).not.toBeNull();
  expect(StyleSheet.flatten(offsetContainer!.props.style)).toBeUndefined();
});

it('keeps the surface mounted across root, child, and keyboard inset changes', async () => {
  mockBottomInset = 34;
  const controller = createNavigationController<'home' | 'details'>('home');
  const rootTabs = { activeTab: 'home' as const, onSelect: jest.fn() };
  const bar = (showRootTabs: boolean, keyboardVisible: boolean) =>
    withSafeAreaInsets(
      <NavigationActionBar
        controller={controller}
        keyboardVisible={keyboardVisible}
        rootTabs={showRootTabs ? rootTabs : undefined}
        showHome={!showRootTabs}
        surface={TrackingSurface}
      />,
    );
  const view = await render(bar(true, false));
  const translation = () => {
    const position = screen.getByTestId('navigation-bar-fallback').parent;
    expect(position).not.toBeNull();
    return StyleSheet.flatten(position!.props.style)?.transform;
  };

  expect(surfaceMountCount).toBe(1);
  expect(surfaceUnmountCount).toBe(0);
  expect(translation()).toEqual([{ translateY: 10 }]);

  await view.rerender(bar(true, true));
  expect(surfaceMountCount).toBe(1);
  expect(surfaceUnmountCount).toBe(0);
  expect(translation()).toBeUndefined();

  await view.rerender(bar(true, false));
  await act(async () => {
    controller.push('details');
  });
  await view.rerender(bar(false, false));
  expect(screen.getByTestId('navigation-back')).toBeVisible();
  expect(surfaceMountCount).toBe(1);
  expect(surfaceUnmountCount).toBe(0);
  expect(translation()).toBeUndefined();

  await act(async () => {
    controller.reconcileNativeBack(controller.getSnapshot().currentRoute.key);
    await view.rerender(bar(true, false));
  });
  expect(screen.getByTestId('navigation-tab-home')).toBeVisible();
  expect(surfaceMountCount).toBe(1);
  expect(surfaceUnmountCount).toBe(0);
  expect(translation()).toEqual([{ translateY: 10 }]);
});
