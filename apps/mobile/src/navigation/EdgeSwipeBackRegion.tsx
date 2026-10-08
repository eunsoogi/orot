import type { ReactNode } from 'react';
import { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import type { PanResponderGestureState } from 'react-native';
import type { NavigationController } from './navigationController';

const edgeWidth = 32;
const activationDistance = 12;
const completionDistance = 72;
const horizontalDominance = 1.2;

interface EdgeGestureProgress {
  readonly x0: number;
  readonly dx: number;
  readonly dy: number;
}

interface BackAvailability {
  readonly canGoBack: boolean;
  readonly isTransitioning: boolean;
}

export function shouldClaimEdgeBackGesture(
  gesture: EdgeGestureProgress,
  availability: BackAvailability,
): boolean {
  return (
    availability.canGoBack &&
    !availability.isTransitioning &&
    gesture.x0 >= 0 &&
    gesture.x0 <= edgeWidth &&
    gesture.dx >= activationDistance &&
    gesture.dx > Math.abs(gesture.dy) * horizontalDominance
  );
}

export function shouldCompleteEdgeBackGesture(
  gesture: Pick<PanResponderGestureState, 'dx' | 'dy'>,
): boolean {
  return (
    gesture.dx >= completionDistance &&
    gesture.dx > Math.abs(gesture.dy) * horizontalDominance
  );
}

export function requestBackAfterEdgeGesture<Name extends string>(
  controller: NavigationController<Name>,
  gesture: Pick<PanResponderGestureState, 'dx' | 'dy'>,
): Promise<boolean> {
  return shouldCompleteEdgeBackGesture(gesture)
    ? controller.requestBack()
    : Promise.resolve(false);
}

export interface EdgeSwipeBackRegionProps<Name extends string> {
  readonly children: ReactNode;
  readonly controller: NavigationController<Name>;
}

export function EdgeSwipeBackRegion<Name extends string>({
  children,
  controller,
}: EdgeSwipeBackRegionProps<Name>) {
  const touchStartX = useRef<number | null>(null);
  const preGrantMovement = useRef({ dx: 0, dy: 0 });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: event => {
          const startX = event.nativeEvent.pageX;
          touchStartX.current =
            event.nativeEvent.touches.length === 1 && Number.isFinite(startX)
              ? startX
              : null;
          preGrantMovement.current = { dx: 0, dy: 0 };
          return false;
        },
        onMoveShouldSetPanResponderCapture: (_event, gesture) => {
          const x0 = touchStartX.current;
          const shouldClaim =
            x0 !== null &&
            gesture.numberActiveTouches === 1 &&
            shouldClaimEdgeBackGesture(
              { x0, dx: gesture.dx, dy: gesture.dy },
              controller.getSnapshot(),
            );
          if (shouldClaim) {
            preGrantMovement.current = { dx: gesture.dx, dy: gesture.dy };
          }
          return shouldClaim;
        },
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_event, gesture) => {
          touchStartX.current = null;
          const totalMovement = {
            dx: preGrantMovement.current.dx + gesture.dx,
            dy: preGrantMovement.current.dy + gesture.dy,
          };
          preGrantMovement.current = { dx: 0, dy: 0 };
          requestBackAfterEdgeGesture(controller, totalMovement).then(
            () => undefined,
            () => undefined,
          );
        },
        // A system or scroll-view cancellation is not a completed back gesture.
        onPanResponderTerminate: () => {
          touchStartX.current = null;
          preGrantMovement.current = { dx: 0, dy: 0 };
        },
      }),
    [controller],
  );

  return (
    <View
      {...responder.panHandlers}
      style={styles.fill}
      testID="edge-swipe-back-region"
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
