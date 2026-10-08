import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import type { ReactNode } from 'react';
import { createNavigationController } from '../navigationController';
import { NavigationActionBar } from '../NavigationActionBar';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

  return {
    SafeAreaView: ({
      children,
      edges,
      style,
      testID,
    }: {
      children?: ReactNode;
      edges?: readonly string[];
      style?: object;
      testID?: string;
    }) =>
      React.createElement(
        NativeView,
        { accessibilityHint: edges?.join(','), style, testID },
        children,
      ),
  };
});

const mockUseColorScheme = jest.mocked(useColorScheme);

function FallbackSurface({
  children,
  testID,
}: {
  children: ReactNode;
  testID: string;
}) {
  return <View testID={testID}>{children}</View>;
}

describe('bottom navigation actions', () => {
  afterEach(() => mockUseColorScheme.mockReturnValue('light'));

  it('uses the shared back request and a descriptive accessible name', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    await act(async () => {
      controller.push('details');
    });
    const requestBack = jest.spyOn(controller, 'requestBack');

    await render(
      <NavigationActionBar controller={controller} safeAreaHandledByParent />,
    );

    const back = screen.getByRole('button', {
      name: '이전 화면으로 돌아가기',
    });
    await fireEvent.press(back);
    expect(requestBack).toHaveBeenCalledTimes(1);
  });

  it('distinguishes home from back and leaves the root with the same guard', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    controller.push('details');
    const requestHome = jest.spyOn(controller, 'requestHome');

    await render(
      <NavigationActionBar
        controller={controller}
        showHome
        safeAreaHandledByParent
      />,
    );

    const home = screen.getByRole('button', { name: '홈 화면으로 이동' });
    await fireEvent.press(home);
    expect(requestHome).toHaveBeenCalledTimes(1);
  });

  it('updates when the shared controller pushes a child route', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    await render(
      <NavigationActionBar controller={controller} safeAreaHandledByParent />,
    );

    expect(screen.queryByTestId('navigation-back')).toBeNull();
    await act(async () => {
      controller.push('details');
    });
    expect(
      screen.getByRole('button', { name: '이전 화면으로 돌아가기' }),
    ).toBeVisible();
  });

  it('keeps a readable solid fallback when glass or transparency is unavailable', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    controller.push('details');
    await render(
      <NavigationActionBar
        controller={controller}
        showHome
        safeAreaHandledByParent
        surface={FallbackSurface}
      />,
    );

    expect(screen.getByTestId('navigation-bar-fallback')).toBeVisible();
    expect(
      screen.getByRole('button', { name: '홈 화면으로 이동' }),
    ).toBeVisible();
  });

  it('uses a light control foreground for dark system appearance', async () => {
    mockUseColorScheme.mockReturnValue('dark');
    const controller = createNavigationController<'home' | 'details'>('home');
    controller.push('details');

    await render(
      <NavigationActionBar controller={controller} safeAreaHandledByParent />,
    );

    const back = screen.getByRole('button', {
      name: '이전 화면으로 돌아가기',
    });
    expect(StyleSheet.flatten(back.props.style)).toEqual(
      expect.objectContaining({ borderColor: '#f7f8fa' }),
    );
    expect(StyleSheet.flatten(screen.getByText('뒤로').props.style)).toEqual(
      expect.objectContaining({ color: '#f7f8fa' }),
    );
  });

  it('selects the native view-manager surface on iOS', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    controller.push('details');
    await render(
      <NavigationActionBar controller={controller} safeAreaHandledByParent />,
    );

    const surfaceID =
      Platform.OS === 'ios'
        ? 'navigation-bar-native-surface'
        : 'navigation-bar-fallback';
    expect(screen.getByTestId(surfaceID)).toBeVisible();
  });

  it('keeps navigation actions available when the keyboard is visible', async () => {
    const controller = createNavigationController<'home' | 'editor'>('home');
    controller.push('editor');

    await render(
      <NavigationActionBar controller={controller} showHome keyboardVisible />,
    );

    expect(screen.getByTestId('bottom-navigation-action-bar')).toBeVisible();
    expect(
      screen.getByRole('button', { name: '홈 화면으로 이동' }),
    ).toBeVisible();
    expect(
      screen.getByTestId('navigation-action-bar-safe-area').props
        .accessibilityHint,
    ).toBe('');
  });
});
