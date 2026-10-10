import { act, render, screen } from '@testing-library/react-native';
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

describe('native bottom navigation toolbar', () => {
  it('mounts route actions as toolbar items and routes their taps', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    controller.push('details');
    const requestBack = jest.spyOn(controller, 'requestBack');

    await render(
      <NavigationActionBar
        controller={controller}
        showHome
        primaryAction={{
          label: '녹음',
          accessibilityLabel: '녹음 화면으로 이동',
          onPress: jest.fn(),
          testID: 'navigation-recording',
        }}
        safeAreaHandledByParent
      />,
    );

    const toolbar = screen.getByTestId('navigation-bar-native-surface');
    expect(toolbar.props.actions).toEqual([
      expect.objectContaining({
        id: 'back',
        label: '뒤로',
        accessibilityLabel: '이전 화면으로 돌아가기',
        testID: 'navigation-back',
        systemImageName: 'chevron.backward',
      }),
      expect.objectContaining({
        id: 'home',
        label: '홈',
        accessibilityLabel: '홈 화면으로 이동',
        testID: 'navigation-home',
        systemImageName: 'house',
      }),
      expect.objectContaining({
        id: 'primary',
        label: '녹음',
        accessibilityLabel: '녹음 화면으로 이동',
        testID: 'navigation-recording',
        primary: true,
      }),
    ]);

    await act(async () => {
      toolbar.props.onAction({ nativeEvent: { id: 'back' } });
    });
    expect(requestBack).toHaveBeenCalledTimes(1);
  });

  it('routes callback-route actions through the native toolbar items', async () => {
    const onBack = jest.fn();
    const onHome = jest.fn();
    const onPrimary = jest.fn();
    await render(
      <BottomNavigationMenu
        onBack={onBack}
        onHome={onHome}
        testID="calendar-back"
        primaryAction={{
          label: '녹음',
          accessibilityLabel: '녹음 화면으로 이동',
          onPress: onPrimary,
          testID: 'navigation-recording',
        }}
      />,
    );

    const toolbar = screen.getByTestId('navigation-bar-native-surface');
    expect(toolbar.props.actions).toEqual([
      expect.objectContaining({ id: 'back', testID: 'calendar-back' }),
      expect.objectContaining({ id: 'home', testID: 'navigation-home' }),
      expect.objectContaining({
        id: 'primary',
        testID: 'navigation-recording',
      }),
    ]);

    await act(async () => {
      toolbar.props.onAction({ nativeEvent: { id: 'back' } });
      toolbar.props.onAction({ nativeEvent: { id: 'home' } });
      toolbar.props.onAction({ nativeEvent: { id: 'primary' } });
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('keeps native back disabled while leaving the current route is blocked', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    controller.push('details');
    const requestBack = jest.spyOn(controller, 'requestBack');
    await render(
      <NavigationActionBar
        controller={controller}
        leaveDisabled
        safeAreaHandledByParent
      />,
    );

    const toolbar = screen.getByTestId('navigation-bar-native-surface');
    expect(toolbar.props.actions).toEqual([
      expect.objectContaining({ id: 'back', disabled: true }),
    ]);
    await act(async () => {
      toolbar.props.onAction({ nativeEvent: { id: 'back' } });
    });
    expect(requestBack).not.toHaveBeenCalled();
  });

  it('keeps navigation actions available when the keyboard is visible', async () => {
    const controller = createNavigationController<'home' | 'editor'>('home');
    controller.push('editor');

    await render(
      <NavigationActionBar controller={controller} showHome keyboardVisible />,
    );

    const toolbar = screen.getByTestId('navigation-bar-native-surface');
    expect(toolbar).toBeVisible();
    expect(toolbar.props.actions).toEqual([
      expect.objectContaining({ id: 'back', disabled: false }),
      expect.objectContaining({
        id: 'home',
        accessibilityLabel: '홈 화면으로 이동',
        disabled: false,
      }),
    ]);
    expect(
      screen.getByTestId('navigation-action-bar-safe-area').props
        .accessibilityHint,
    ).toBe('');
  });
});
