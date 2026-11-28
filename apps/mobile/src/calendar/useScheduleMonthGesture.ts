import { useLayoutEffect, useRef, useState } from 'react';
import type { GestureResponderEvent, ViewProps } from 'react-native';
import { useNavigationRouteScrollSuspension } from '../navigation/NavigationRouteScrollView';

const MAX_DENSITY = 6;
const SPREAD_POINTS_PER_STEP = 16;
const HORIZONTAL_GRANT = 14;
const HORIZONTAL_PAGE = 64;

type Touch = GestureResponderEvent['nativeEvent'];
type AxisPoint = { x: number; y: number };
type Gesture = {
  readonly releaseScroll?: () => void;
  readonly mode: 'horizontal' | 'pinch';
  readonly origin?: AxisPoint;
  readonly density?: number;
  readonly span?: number;
  readonly pair?: string;
};

function point(touch: Touch): AxisPoint {
  return { x: touch.pageX, y: touch.pageY };
}

function verticalPair(touches: readonly Touch[]) {
  if (touches.length !== 2) return null;
  const [first, second] = touches;
  if (!Number.isFinite(first.pageY) || !Number.isFinite(second.pageY))
    return null;
  return {
    key: [first.identifier, second.identifier].sort().join(':'),
    span: Math.abs(first.pageY - second.pageY),
  };
}

function horizontalTravel(origin: AxisPoint | null, touch?: Touch): number {
  if (!origin || !touch) return 0;
  const x = touch.pageX - origin.x;
  const y = touch.pageY - origin.y;
  return Math.abs(x) >= Math.abs(y) * 1.7 ? x : 0;
}

/** Owns calendar gestures only after a second finger or clear horizontal intent. */
export function useScheduleMonthGesture(
  onSwipeMonth?: (amount: -1 | 1) => void,
) {
  const suspendScroll = useNavigationRouteScrollSuspension();
  const origin = useRef<AxisPoint | null>(null);
  const localTouches = useRef(new Set<Touch['identifier']>());
  const gesture = useRef<Gesture | null>(null);
  const step = useRef(0);
  const [density, setDensity] = useState(0);
  const reset = () => {
    const current = gesture.current;
    gesture.current = null;
    origin.current = null;
    localTouches.current.clear();
    current?.releaseScroll?.();
  };
  useLayoutEffect(() => () => gesture.current?.releaseScroll?.(), []);
  // RN reports all touches on the surface, including fingers outside this grid.
  const localPair = (touches: readonly Touch[]) =>
    touches.every(touch => localTouches.current.has(touch.identifier))
      ? verticalPair(touches)
      : null;
  const forgetEndedTouches = ({ nativeEvent }: GestureResponderEvent) => {
    for (const ended of nativeEvent.changedTouches)
      localTouches.current.delete(ended.identifier);
    if (!nativeEvent.touches.length && !gesture.current) origin.current = null;
  };
  const updatePinch = (touches: readonly Touch[]) => {
    const current = gesture.current;
    const pair = localPair(touches);
    if (!current || !pair) return;
    // Changing fingers rebases from the current layout instead of jumping.
    if (current.mode !== 'pinch' || current.pair !== pair.key) {
      gesture.current = {
        mode: 'pinch',
        pair: pair.key,
        span: pair.span,
        density: step.current,
        releaseScroll: current.releaseScroll,
      };
      return;
    }
    const delta = Math.round(
      (pair.span - current.span!) / SPREAD_POINTS_PER_STEP,
    );
    const next = Math.max(0, Math.min(MAX_DENSITY, current.density! + delta));
    if (next !== step.current) {
      step.current = next;
      setDensity(next);
    }
  };
  const responders: Pick<
    ViewProps,
    | 'onTouchEndCapture'
    | 'onTouchCancel'
    | 'onStartShouldSetResponderCapture'
    | 'onMoveShouldSetResponderCapture'
    | 'onResponderGrant'
    | 'onResponderStart'
    | 'onResponderMove'
    | 'onResponderRelease'
    | 'onResponderTerminate'
    | 'onResponderTerminationRequest'
  > = {
    onTouchEndCapture: forgetEndedTouches,
    onTouchCancel: forgetEndedTouches,
    onStartShouldSetResponderCapture: ({ nativeEvent }) => {
      if (nativeEvent.touches.length === 1) localTouches.current.clear();
      for (const started of nativeEvent.changedTouches)
        localTouches.current.add(started.identifier);
      if (nativeEvent.touches.length === 1)
        origin.current = point(nativeEvent.touches[0]);
      return localPair(nativeEvent.touches) !== null;
    },
    onMoveShouldSetResponderCapture: ({ nativeEvent }) =>
      localPair(nativeEvent.touches) !== null ||
      (Boolean(onSwipeMonth) &&
        nativeEvent.touches.length === 1 &&
        Math.abs(horizontalTravel(origin.current, nativeEvent.touches[0])) >=
          HORIZONTAL_GRANT),
    onResponderGrant: ({ nativeEvent }) => {
      gesture.current = {
        mode: 'horizontal',
        origin: origin.current ?? point(nativeEvent),
        releaseScroll: suspendScroll?.(),
      };
      updatePinch(nativeEvent.touches);
    },
    onResponderStart: ({ nativeEvent }) => updatePinch(nativeEvent.touches),
    onResponderMove: ({ nativeEvent }) => updatePinch(nativeEvent.touches),
    onResponderRelease: ({ nativeEvent }) => {
      const current = gesture.current;
      const travel =
        current?.mode === 'horizontal'
          ? horizontalTravel(
              current.origin ?? null,
              nativeEvent.changedTouches[0],
            )
          : 0;
      reset();
      if (Math.abs(travel) >= HORIZONTAL_PAGE)
        onSwipeMonth?.(travel < 0 ? 1 : -1);
    },
    onResponderTerminate: reset,
    onResponderTerminationRequest: () => false,
  };
  return { density, responders };
}
