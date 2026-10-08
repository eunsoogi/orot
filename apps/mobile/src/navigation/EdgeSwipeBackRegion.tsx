import type { ReactNode } from 'react';
import { useMemo } from 'react';
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
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          shouldClaimEdgeBackGesture(gesture, controller.getSnapshot()),
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_event, gesture) => {
          requestBackAfterEdgeGesture(controller, gesture).then(
            () => undefined,
            () => undefined,
          );
        },
        // A system or scroll-view cancellation is not a completed back gesture.
        onPanResponderTerminate: () => undefined,
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
