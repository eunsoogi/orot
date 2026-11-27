import { useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type PanResponderGestureState,
} from 'react-native';

const revealWidth = 88;
const claimDistance = 12;
const settleDistance = 36;
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
}: {
  readonly action: ReactNode;
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly revealed: boolean;
  readonly onRevealedChange: (revealed: boolean) => void;
  readonly testID: string;
}) {
  const [offset] = useState(() => new Animated.Value(0));
  const expanded = revealed && !disabled;
  const settled = expanded ? -revealWidth : 0;
  useLayoutEffect(() => offset.setValue(settled), [offset, settled]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          !disabled &&
          gesture.numberActiveTouches === 1 &&
          horizontal(gesture) &&
          (gesture.dx <= -claimDistance ||
            (expanded && gesture.dx >= claimDistance)),
        onPanResponderMove: (_event, gesture) => {
          if (disabled || gesture.numberActiveTouches !== 1) {
            offset.setValue(settled);
            return;
          }
          offset.setValue(
            Math.max(-revealWidth, Math.min(0, settled + gesture.dx)),
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          let next = expanded;
          if (!disabled && horizontal(gesture)) {
            if (gesture.dx <= -settleDistance) next = true;
            else if (gesture.dx >= settleDistance) next = false;
          }
          offset.setValue(next ? -revealWidth : 0);
          if (next !== expanded) onRevealedChange(next);
        },
        onPanResponderTerminate: () => offset.setValue(settled),
        // The route must remain able to take over a vertical scroll.
        onPanResponderTerminationRequest: () => true,
      }),
    [disabled, expanded, offset, onRevealedChange, settled],
  );
  return (
    <View style={styles.clip} testID={testID} {...responder.panHandlers}>
      {expanded ? <View style={styles.action}>{action}</View> : null}
      <Animated.View style={{ transform: [{ translateX: offset }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  action: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: revealWidth,
  },
});
