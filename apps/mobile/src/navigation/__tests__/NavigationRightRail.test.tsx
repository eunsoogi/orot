import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { NavigationGeometryProvider } from '../NavigationGeometryProvider';
import { dividedGeometry as duoGeometry } from '../__fixtures__/navigationOpenGeometry';
import { NavigationActionBar } from '../NavigationActionBar';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import { NavigationViewport } from '../NavigationViewport';
import { createNavigationController } from '../navigationController';
import { NAVIGATION_CONTENT_GAP } from '../navigationLayout';
import { useNavigationContentInset } from '../useNavigationContentInset';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

  return {
    SafeAreaInsetsContext: React.createContext(null),
    SafeAreaProvider: NativeView,
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

const lifecycle = { mounted: 0, unmounted: 0 };

function TrackingSurface({
  actions = [],
  children,
  layoutMode,
  style,
  testID,
}: NavigationSurfaceProps) {
  useEffect(() => {
    lifecycle.mounted += 1;
    return () => {
      lifecycle.unmounted += 1;
    };
  }, []);

  return (
    <View accessibilityHint={layoutMode} style={style} testID={testID}>
      <Text testID={`${testID}-actions`}>
        {actions.map(action => action.id).join(',')}
      </Text>
      {children}
    </View>
  );
}

function RouteContents() {
  const [draft, setDraft] = useState('untouched');
  const inset = useNavigationContentInset();

  return (
    <View>
      <Text testID="route-draft">{draft}</Text>
      <Text
        testID="route-bottom-inset"
        style={{ paddingBottom: inset.paddingBottom }}
      >
        {inset.paddingBottom}
      </Text>
      <View style={inset} testID="page-end-space" />
      <Pressable onPress={() => setDraft('edited')} testID="edit-draft">
        <Text>Edit draft</Text>
      </Pressable>
    </View>
  );
}

function NavigationFixture({ showPrimary }: { readonly showPrimary: boolean }) {
  const [controller] = useState(() =>
    createNavigationController<'home' | 'records'>('home'),
  );

  return (
    <NavigationGeometryProvider>
      <NavigationViewport
        actionBar={
          <NavigationActionBar
            controller={controller}
            primaryAction={
              showPrimary
                ? {
                    label: '녹음',
                    accessibilityLabel: '녹음 시작',
                    onPress: () => undefined,
                    testID: 'navigation-recording',
                  }
                : undefined
            }
            rootTabs={{ activeTab: 'home', onSelect: () => undefined }}
            surface={TrackingSurface}
          />
        }
        childHandlesSafeArea={false}
      >
        <RouteContents />
      </NavigationViewport>
    </NavigationGeometryProvider>
  );
}

beforeEach(() => {
  lifecycle.mounted = 0;
  lifecycle.unmounted = 0;
});

test('moves root actions into the right lane without losing route state or bottom clearance', async () => {
  const { rerender } = await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 40, right: 22, bottom: 30, left: 14 }}
    >
      <NavigationFixture showPrimary />
    </SafeAreaInsetsContext.Provider>,
  );
  await fireEvent.press(screen.getByTestId('edit-draft'));
  expect(screen.getByTestId('route-draft').props.children).toBe('edited');

  const overlay = screen.getByTestId('navigation-action-bar-overlay');
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 144, width: 1000, x: 0, y: 0 } },
  });
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  await fireEvent(sensor, 'geometryChange', { nativeEvent: duoGeometry });

  expect(
    StyleSheet.flatten(
      screen.getByTestId('navigation-content-region').props.style,
    ),
  ).toEqual(
    expect.objectContaining({ bottom: 30, right: 72, top: 40, left: 14 }),
  );
  expect(
    screen.getByTestId('navigation-safe-area-content').props.accessibilityHint,
  ).toBe('top,right,left');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('navigation-right-rail-host').props.style,
    ),
  ).toEqual(expect.objectContaining({ height: 900, width: 60 }));
  expect(
    screen.getByTestId('navigation-right-rail').props.accessibilityHint,
  ).toBe('right');
  expect(
    screen.getByTestId('navigation-right-rail-actions').props.children,
  ).not.toContain('primary');
  expect(
    screen.getByTestId('navigation-primary-action-surface-actions').props
      .children,
  ).toBe('primary');
  expect(screen.getByTestId('route-draft').props.children).toBe('edited');
  expect(lifecycle).toEqual({ mounted: 2, unmounted: 0 });

  // The right lane reserves the system bottom once, leaving only the real action overlap for scrolling.
  await fireEvent(screen.getByTestId('navigation-content-region'), 'layout', {
    nativeEvent: { layout: { height: 830, width: 914, x: 14, y: 40 } },
  });
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 72, width: 1000, x: 0, y: 828 } },
  });
  expect(screen.getByTestId('route-bottom-inset').props.children).toBe(
    42 + NAVIGATION_CONTENT_GAP,
  );
  expect(screen.getByTestId('page-end-space').props.style).toEqual({
    paddingBottom: 42 + NAVIGATION_CONTENT_GAP,
  });

  await rerender(
    <SafeAreaInsetsContext.Provider
      value={{ top: 40, right: 22, bottom: 30, left: 14 }}
    >
      <NavigationFixture showPrimary={false} />
    </SafeAreaInsetsContext.Provider>,
  );
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 0, width: 1000, x: 0, y: 0 } },
  });
  expect(screen.getByTestId('route-bottom-inset').props.children).toBe(
    NAVIGATION_CONTENT_GAP,
  );
  expect(screen.getByTestId('route-draft').props.children).toBe('edited');
  expect(lifecycle).toEqual({ mounted: 2, unmounted: 1 });

  const standardGeometry = {
    ...duoGeometry,
    reservedRegions: [],
  };
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    {
      nativeEvent: standardGeometry,
    },
  );
  expect(
    screen.getByTestId('navigation-bar-fallback').props.accessibilityHint,
  ).toBe('bottom');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('navigation-content-region').props.style,
    ),
  ).toEqual({
    flex: 1,
    position: 'absolute',
    top: 40,
    left: 14,
    right: 22,
    bottom: 30,
  });
  // Bottom placement keeps the same safe frame; the removed system edge is not scroll padding.
  await fireEvent(screen.getByTestId('navigation-content-region'), 'layout', {
    nativeEvent: { layout: { height: 830, width: 964, x: 14, y: 40 } },
  });
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 72, width: 1000, x: 0, y: 828 } },
  });
  expect(screen.getByTestId('route-bottom-inset').props.children).toBe(
    42 + NAVIGATION_CONTENT_GAP,
  );
  expect(screen.getByTestId('route-draft').props.children).toBe('edited');
  expect(lifecycle).toEqual({ mounted: 2, unmounted: 1 });
});
