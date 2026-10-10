import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { NavigationSurfaceProps } from '../NavigationActionBar';
import type { NavigationRouteActions } from '../NavigationRouteAdapter';
import { NavigationRouteAdapter } from '../NavigationRouteAdapter';
import { createNavigationController } from '../navigationController';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

  return {
    SafeAreaInsetsContext: React.createContext({
      top: 0,
      left: 0,
      right: 0,
      bottom: 34,
    }),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 34 }),
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
    nativeEvent: { pageX: currentX, touches: [{}] },
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

function LeaveStateOwner({
  registerLeaveState,
}: {
  registerLeaveState: NavigationRouteActions<TestRoute>['registerLeaveState'];
}) {
  const [canLeave, setCanLeave] = useState(false);
  const state = useMemo(
    () => ({
      canLeave,
      hasUnsavedChanges: false,
      isRecording: false,
      hasOngoingOperation: false,
      revision: Number(canLeave),
      inputRevision: 0,
    }),
    [canLeave],
  );

  useLayoutEffect(
    () => registerLeaveState({ readState: () => state }),
    [registerLeaveState, state],
  );

  return (
    <Pressable
      onPress={() => setCanLeave(true)}
      testID="allow-navigation-leave"
    >
      <Text>Allow leave</Text>
    </Pressable>
  );
}

describe('shared back inputs', () => {
  it('reflects route leave denial in the bar and the edge-swipe guard', async () => {
    const controller = createNavigationController<TestRoute>('home');
    const editor = controller.push('editor');
    if (!editor) throw new Error('Editor route was unexpectedly rejected.');
    const requestBack = jest.spyOn(controller, 'requestBack');

    await render(
      <NavigationRouteAdapter controller={controller} surface={TestSurface}>
        {({ route, registerLeaveState }) =>
          route.name === 'editor' ? (
            <LeaveStateOwner registerLeaveState={registerLeaveState} />
          ) : null
        }
      </NavigationRouteAdapter>,
    );

    expect(screen.getByTestId('navigation-back')).toBeDisabled();
    const edgeRegion = screen.getByTestId('edge-swipe-back-region');
    const startEvent = createPanEvent(1, 12, 12);
    const claimEvent = createPanEvent(2, 12, 42);
    const releaseEvent = createPanEvent(3, 42, 87);
    edgeRegion.props.onStartShouldSetResponderCapture?.(startEvent);
    expect(edgeRegion.props.onMoveShouldSetResponderCapture?.(claimEvent)).toBe(
      true,
    );
    edgeRegion.props.onResponderGrant?.(claimEvent);
    edgeRegion.props.onResponderMove?.(releaseEvent);
    await act(async () => {
      edgeRegion.props.onResponderRelease?.(releaseEvent);
      await Promise.resolve();
    });

    expect(controller.getSnapshot().currentRoute.name).toBe('editor');
    expect(requestBack).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('navigation-back')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('allow-navigation-leave'));
    expect(screen.getByTestId('navigation-back')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(controller.getSnapshot().currentRoute.name).toBe('home');
    expect(requestBack).toHaveBeenCalledTimes(2);
  });

  it('uses the same operation leave guard for button and accepted edge swipe', async () => {
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
      hasOngoingOperation: true,
      ongoingOperationKind: 'account-connection' as const,
      revision: 1,
      inputRevision: 1,
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
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        reasons: ['unsaved-changes', 'ongoing-operation'],
        ongoingOperationKind: 'account-connection',
      }),
    );
    expect(controller.getSnapshot().isTransitioning).toBe(true);
    await act(async () => {
      confirmationDecisions[0]?.(false);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(controller.getSnapshot().currentRoute.name).toBe('editor');

    const edgeRegion = screen.getByTestId('edge-swipe-back-region');
    expect(edgeRegion).toBeVisible();
    // PanResponder x0 is zero until grant, so the edge start must be tracked directly.
    const centerStartEvent = createPanEvent(1, 120, 120);
    const centerMoveEvent = createPanEvent(2, 120, 150);
    edgeRegion.props.onStartShouldSetResponderCapture?.(centerStartEvent);
    expect(
      edgeRegion.props.onMoveShouldSetResponderCapture?.(centerMoveEvent),
    ).toBe(false);

    const startEvent = createPanEvent(3, 12, 12);
    const claimEvent = createPanEvent(4, 12, 42);
    const releaseEvent = createPanEvent(5, 42, 87);
    edgeRegion.props.onStartShouldSetResponderCapture?.(startEvent);
    expect(edgeRegion.props.onMoveShouldSetResponderCapture?.(claimEvent)).toBe(
      true,
    );
    edgeRegion.props.onResponderGrant?.(claimEvent);
    edgeRegion.props.onResponderMove?.(releaseEvent);
    await act(async () => {
      edgeRegion.props.onResponderRelease?.(releaseEvent);
      confirmationDecisions[1]?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.getSnapshot().currentRoute.name).toBe('home');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        reasons: ['unsaved-changes', 'ongoing-operation'],
        ongoingOperationKind: 'account-connection',
      }),
    );
    expect(readState.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(requestBack).toHaveBeenCalledTimes(2);
  });
});
