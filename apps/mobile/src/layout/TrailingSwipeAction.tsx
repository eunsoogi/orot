import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  I18nManager,
  PanResponder,
  StyleSheet,
  View,
  type PanResponderGestureState,
} from 'react-native';

const defaultRevealWidth = 88;
const claimDistance = 12;
const settleDistance = 36;
const overswipeTravel = 20;
type ContinuousDrag = {
  dx: number;
  x: number;
  turn: number;
  open: boolean;
};

function moveContinuousDrag(drag: ContinuousDrag, dx: number, width: number) {
  const delta = dx - drag.dx;
  drag.dx = dx;
  // Resist further pull past the lane, but never make the finger traverse an
  // invisible dead zone before the card responds to a rightward reversal.
  const laneRemaining = Math.max(0, width + drag.x);
  const resisted =
    delta < 0
      ? Math.max(delta, -laneRemaining) +
        Math.min(0, delta + laneRemaining) * 0.24
      : delta;
  drag.x = Math.max(-width - overswipeTravel, Math.min(0, drag.x + resisted));
  if (drag.open) {
    drag.turn = Math.min(drag.turn, dx);
    if (dx - drag.turn >= settleDistance) {
      drag.open = false;
      drag.turn = dx;
    }
  } else {
    drag.turn = Math.max(drag.turn, dx);
    if (drag.turn - dx >= settleDistance) {
      drag.open = true;
      drag.turn = dx;
    }
  }
}

type Motion = Pick<
  PanResponderGestureState,
  'dx' | 'dy' | 'numberActiveTouches'
>;

function horizontal({ dx, dy }: Motion) {
  return Math.abs(dx) > Math.abs(dy) * 1.35;
}

/** A physical left swipe only reveals a trailing action; it never invokes that action. */
export function TrailingSwipeAction({
  action,
  children,
  disabled,
  revealed,
  onRevealedChange,
  testID,
  revealWidth = defaultRevealWidth,
  revealDuringDrag = false,
  springReveal = false,
}: {
  readonly action: ReactNode;
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly revealed: boolean;
  readonly onRevealedChange: (revealed: boolean) => void;
  readonly testID: string;
  readonly revealWidth?: number;
  /** Paint the covered lane during motion; only the settled reveal can expose actions. */
  readonly revealDuringDrag?: boolean;
  /** Keep the reveal on one continuous responder and rebound after overswipe. */
  readonly springReveal?: boolean;
}) {
  const [offset] = useState(() => new Animated.Value(0));
  const uncovered = useMemo(
    () =>
      offset.interpolate({
        inputRange: [-revealWidth, 0],
        outputRange: [revealWidth, 0],
        extrapolate: 'clamp',
      }),
    [offset, revealWidth],
  );
  const [dragging, setDragging] = useState(false);
  const expanded = revealed && !disabled;
  const canUseActions = expanded && !dragging;
  const settled = expanded ? -revealWidth : 0;
  const drag = useRef<ContinuousDrag | undefined>(undefined);
  const target = useRef(0);
  useLayoutEffect(() => {
    // The parent acknowledges the same target on release; that re-render must
    // not stop the spring. A different owner target (e.g. disabling) wins.
    if (!disabled && target.current === settled) return;
    target.current = settled;
    drag.current = undefined;
    offset.stopAnimation();
    offset.setValue(settled);
    setDragging(false);
  }, [disabled, offset, settled]);
  useLayoutEffect(() => () => offset.stopAnimation(), [offset]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          !disabled &&
          gesture.numberActiveTouches === 1 &&
          horizontal(gesture) &&
          (gesture.dx <= -claimDistance ||
            ((springReveal ? target.current < 0 : expanded) &&
              gesture.dx >= claimDistance)),
        onPanResponderGrant: () => {
          if (!springReveal) return;
          offset.stopAnimation(x => {
            drag.current = { dx: 0, x, turn: 0, open: target.current < 0 };
          });
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => {
          if (disabled || gesture.numberActiveTouches !== 1) {
            drag.current = undefined;
            offset.setValue(settled);
            return;
          }
          if (springReveal) {
            if (!drag.current) return;
            moveContinuousDrag(drag.current, gesture.dx, revealWidth);
            offset.setValue(drag.current.x);
            return;
          }
          offset.setValue(
            Math.max(-revealWidth, Math.min(0, settled + gesture.dx)),
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          const previouslyOpen = springReveal ? target.current < 0 : expanded;
          let next = previouslyOpen;
          if (springReveal) {
            if (!disabled && horizontal(gesture) && drag.current) {
              next = drag.current.open;
            }
            drag.current = undefined;
            target.current = next ? -revealWidth : 0;
            Animated.spring(offset, {
              toValue: target.current,
              useNativeDriver: false, // The same value also drives lane width.
              overshootClamping: true,
            }).start();
          } else if (!disabled && horizontal(gesture)) {
            if (gesture.dx <= -settleDistance) next = true;
            else if (gesture.dx >= settleDistance) next = false;
          }
          if (!springReveal) offset.setValue(next ? -revealWidth : 0);
          if (next !== previouslyOpen) onRevealedChange(next);
          if (springReveal) setDragging(false);
        },
        onPanResponderTerminate: () => {
          drag.current = undefined;
          offset.setValue(springReveal ? target.current : settled);
          if (springReveal) setDragging(false);
        },
        // The route must remain able to take over a vertical scroll.
        onPanResponderTerminationRequest: () => true,
      }),
    [
      disabled,
      expanded,
      offset,
      onRevealedChange,
      springReveal,
      revealWidth,
      settled,
    ],
  );
  const right = I18nManager.isRTL ? styles.rightInRtl : styles.rightInLtr;
  const interaction = {
    pointerEvents: canUseActions ? ('auto' as const) : ('none' as const),
    accessibilityElementsHidden: !canUseActions,
    importantForAccessibility: canUseActions
      ? ('auto' as const)
      : ('no-hide-descendants' as const),
  };
  return (
    <View style={styles.clip} testID={testID} {...responder.panHandlers}>
      {revealDuringDrag ? (
        // Width and row translation share one value. A transparent foreground
        // cannot expose any part of the action lane that is still covered.
        <Animated.View
          {...interaction}
          style={[styles.action, right, styles.clip, { width: uncovered }]}
          testID={`${testID}-action-clip`}
        >
          <View
            style={[styles.action, right, { width: revealWidth }]}
            testID={`${testID}-action-lane`}
          >
            {action}
          </View>
        </Animated.View>
      ) : expanded ? (
        <View
          {...interaction}
          style={[styles.action, styles.legacyRight, { width: revealWidth }]}
        >
          {action}
        </View>
      ) : null}
      <Animated.View
        style={{ transform: [{ translateX: offset }] }}
        testID={`${testID}-content`}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  rightInRtl: { start: 0 },
  rightInLtr: { end: 0 },
  legacyRight: { right: 0 },
});
