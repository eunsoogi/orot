import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import { NavigationRouteAdapter } from '../NavigationRouteAdapter';
import { createNavigationController } from '../navigationController';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

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
        NativeView,
        { accessibilityHint: edges?.join(','), style, testID },
        children,
      ),
  };
});

type TestRoute = 'home' | 'editor';

function createPanEvent(
  timestamp: number,
  previousX: number,
  currentX: number,
) {
  return {
    nativeEvent: { touches: [{}] },
    touchHistory: {
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: timestamp,
      numberActiveTouches: 1,
      touchBank: [
        {
          currentPageX: currentX,
          currentPageY: 20,
          currentTimeStamp: timestamp,
          previousPageX: previousX,
          previousPageY: 20,
          touchActive: true,
        },
      ],
    },
  } as never;
}

function TestSurface({ children, testID }: NavigationSurfaceProps) {
  return <View testID={testID}>{children}</View>;
}

describe('shared back inputs', () => {
  it('uses the same leave guard for button cancellation and accepted edge swipe', async () => {
    const controller = createNavigationController<TestRoute>('home');
    const editor = controller.push('editor');
    if (!editor) throw new Error('Editor route was unexpectedly rejected.');
    const confirmationDecisions: ((approved: boolean) => void)[] = [];
    const confirm = jest.fn(
      () =>
        new Promise<boolean>(resolve => {
          confirmationDecisions.push(resolve);
        }),
    );
    const readState = jest.fn(() => ({
      hasUnsavedChanges: true,
      isRecording: false,
      revision: 1,
    }));
    const requestBack = jest.spyOn(controller, 'requestBack');

    await render(
      <NavigationRouteAdapter
        controller={controller}
        leaveState={{ readState, confirm }}
        surface={TestSurface}
      >
        {({ route }) => <Text testID="route-content">{route.name}</Text>}
      </NavigationRouteAdapter>,
    );

    await fireEvent.press(
      screen.getByRole('button', { name: '이전 화면으로 돌아가기' }),
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().isTransitioning).toBe(true);
    await act(async () => {
      confirmationDecisions[0]?.(false);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(controller.getSnapshot().currentRoute.name).toBe('editor');

    const edgeRegion = screen.getByTestId('edge-swipe-back-region');
    expect(edgeRegion).toBeVisible();
    // Exercise the responder wiring with the touch-history fields PanResponder reads.
    const startEvent = createPanEvent(1, 12, 12);
    const moveEvent = createPanEvent(2, 12, 112);
    edgeRegion.props.onStartShouldSetResponderCapture?.(startEvent);
    expect(edgeRegion.props.onMoveShouldSetResponderCapture?.(moveEvent)).toBe(
      true,
    );
    await act(async () => {
      edgeRegion.props.onResponderRelease?.(moveEvent);
      confirmationDecisions[1]?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.getSnapshot().currentRoute.name).toBe('home');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(readState).toHaveBeenCalledTimes(3);
    expect(requestBack).toHaveBeenCalledTimes(2);
  });
});
