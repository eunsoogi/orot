import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import { createNavigationController } from '../navigationController';
import { NavigationActionBar } from '../NavigationActionBar';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

  return {
    SafeAreaInsetsContext: React.createContext(null),
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
    const onPrimary = jest.fn();

    await render(
      <NavigationActionBar
        controller={controller}

        primaryAction={{
          label: '녹음',
          accessibilityLabel: '녹음 화면으로 이동',
          onPress: onPrimary,
          testID: 'navigation-recording',
          systemImageName: 'mic',
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
    ]);
    const pageDock = screen.getByTestId('navigation-page-action-surface');
    expect(pageDock.props.actions).toEqual([
      expect.objectContaining({
        id: 'page:primary',
        label: '녹음',
        accessibilityLabel: '녹음 화면으로 이동',
        testID: 'navigation-recording',
        primary: true,
      }),
    ]);
    const actions = toolbar.props.actions as Array<Record<string, unknown>>;
    expect(
      actions.every(
        action => action.rootTab !== true && action.selected !== true,
      ),
    ).toBe(true);

    await act(async () => {
      pageDock.props.onAction({ nativeEvent: { id: 'page:primary' } });
      toolbar.props.onAction({ nativeEvent: { id: 'back' } });
    });
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(requestBack).toHaveBeenCalledTimes(1);
  });

  it('marks all root destinations for selected-only tab presentation', async () => {
    const controller = createNavigationController<'home'>('home');
    await render(
      <NavigationActionBar
        controller={controller}
        rootTabs={{ activeTab: 'overview', onSelect: jest.fn() }}
        safeAreaHandledByParent
      />,
    );

    const toolbar = screen.getByTestId('navigation-bar-native-surface');
    const actions = toolbar.props.actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(5);
    expect(actions.map(action => action.id)).toEqual([
      'tab-conversation',
      'tab-overview',
      'tab-records',
      'tab-schedule',
      'tab-settings',
    ]);
    expect(actions.map(action => action.rootTab)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(
      actions.filter(action => action.selected).map(action => action.id),
    ).toEqual(['tab-overview']);
    expect(actions[0]).toEqual(
      expect.objectContaining({
        id: 'tab-conversation',
        selected: false,
        systemImageName: 'sparkle',
      }),
    );
    expect(actions[1]).toEqual(
      expect.objectContaining({
        id: 'tab-overview',
        selected: true,
        systemImageName: 'house.fill',
      }),
    );
    expect(StyleSheet.flatten(toolbar.props.style)).toEqual(
      expect.objectContaining({ height: 60 }),
    );
  });

  it('places a route-owned Back first in the native Duo toolbar and dispatches it', async () => {
    const controller = createNavigationController<'home'>('home');
    const requestBack = jest.spyOn(controller, 'requestBack');
    const closeDetail = jest.fn();
    await render(
      <NavigationActionBar
        controller={controller}
        routeBackAction={{ onPress: closeDetail }}
        rootTabs={{ activeTab: 'records', onSelect: jest.fn() }}
        safeAreaHandledByParent
      />,
    );

    const toolbar = screen.getByTestId('navigation-bar-native-surface');
    const actions = toolbar.props.actions as Array<Record<string, unknown>>;
    expect(actions[0]).toEqual(
      expect.objectContaining({
        id: 'back',
        label: '뒤로',
        accessibilityLabel: '이전 화면으로 돌아가기',
        testID: 'navigation-back',
        systemImageName: 'chevron.backward',
        showsTitleWithSystemImage: true,
      }),
    );
    expect(actions.slice(1).every(action => action.rootTab === true)).toBe(
      true,
    );
    await act(async () => {
      toolbar.props.onAction({ nativeEvent: { id: 'back' } });
    });
    expect(closeDetail).toHaveBeenCalledTimes(1);
    expect(requestBack).not.toHaveBeenCalled();
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
      <NavigationActionBar controller={controller} keyboardVisible />,
    );

    const toolbar = screen.getByTestId('navigation-bar-native-surface');
    expect(toolbar).toBeVisible();
    expect(toolbar.props.actions).toEqual([
      expect.objectContaining({ id: 'back', disabled: false }),
    ]);
    expect(
      screen.getByTestId('navigation-action-bar-safe-area').props
        .accessibilityHint,
    ).toBe('');
  });
});
