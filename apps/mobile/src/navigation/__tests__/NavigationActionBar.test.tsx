import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import type { ReactNode } from 'react';
import { createNavigationController } from '../navigationController';
import { NavigationActionBar } from '../NavigationActionBar';
import { BottomNavigationMenu } from '../BottomNavigationMenu';

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
      <NavigationActionBar
        controller={controller}
        safeAreaHandledByParent
        surface={FallbackSurface}
      />,
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
        surface={FallbackSurface}
        safeAreaHandledByParent
      />,
    );

    const home = screen.getByRole('button', { name: '홈 화면으로 이동' });
    await fireEvent.press(home);
    expect(requestHome).toHaveBeenCalledTimes(1);
  });

  it('shows the core action at the root with its descriptive accessible name', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    const openRecording = jest.fn();

    await render(
      <NavigationActionBar
        controller={controller}
        primaryAction={{
          label: '녹음',
          accessibilityLabel: '녹음 화면으로 이동',
          onPress: openRecording,
          testID: 'navigation-recording',
        }}
        surface={FallbackSurface}
        safeAreaHandledByParent
      />,
    );

    const recording = screen.getByRole('button', {
      name: '녹음 화면으로 이동',
    });
    expect(recording).toBeVisible();
    expect(recording.props.testID).toBe('navigation-recording');
    expect(screen.queryByTestId('navigation-back')).toBeNull();
    await fireEvent.press(recording);
    expect(openRecording).toHaveBeenCalledTimes(1);
  });

  it('updates when the shared controller pushes a child route', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    await render(
      <NavigationActionBar
        controller={controller}
        safeAreaHandledByParent
        surface={FallbackSurface}
      />,
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
      <NavigationActionBar
        controller={controller}
        safeAreaHandledByParent
        surface={FallbackSurface}
      />,
    );

    const back = screen.getByRole('button', {
      name: '이전 화면으로 돌아가기',
    });
    expect(StyleSheet.flatten(back.props.style)).toEqual(
      expect.objectContaining({ borderColor: '#ffffff', borderWidth: 1 }),
    );
    expect(StyleSheet.flatten(screen.getByText('뒤로').props.style)).toEqual(
      expect.objectContaining({ color: '#f7f8fa' }),
    );
  });

  it('keeps callback-route controls legible in dark appearance', async () => {
    mockUseColorScheme.mockReturnValue('dark');
    await render(
      <BottomNavigationMenu
        onBack={jest.fn()}
        testID="calendar-back"
        primaryAction={{
          label: '녹음',
          accessibilityLabel: '녹음 화면으로 이동',
          onPress: jest.fn(),
          testID: 'navigation-recording',
        }}
        surface={FallbackSurface}
      />,
    );

    expect(
      screen.getByRole('button', { name: '이전 화면으로 돌아가기' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: '녹음 화면으로 이동' }),
    ).toBeVisible();
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
});
