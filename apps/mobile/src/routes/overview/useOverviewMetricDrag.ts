import { useLayoutEffect, useRef, useState } from 'react';
import type { GestureResponderEvent, LayoutRectangle } from 'react-native';
import { useNavigationRouteScrollSuspension } from '../../navigation/NavigationRouteScrollView';
import type { OverviewMetricChoice } from './metricSelection';

interface MetricDrag {
  readonly metric: OverviewMetricChoice;
  readonly origin: number;
  readonly pointerId: GestureResponderEvent['nativeEvent']['identifier'];
  readonly from: number;
  readonly selection: readonly OverviewMetricChoice[];
  readonly centers: readonly number[];
  readonly releaseScroll?: () => void;
}

/** Measures real row centers to support variable-height labels without guessing a row height. */
export function useOverviewMetricDrag(
  selection: readonly OverviewMetricChoice[],
  disabled: boolean,
  onMove: (metric: OverviewMetricChoice, index: number) => void,
) {
  const suspendScroll = useNavigationRouteScrollSuspension();
  const drag = useRef<MetricDrag | null>(null);
  const measured = useRef(new Map<OverviewMetricChoice, LayoutRectangle>());
  const [preview, setPreview] = useState<{
    metric: OverviewMetricChoice;
    delta: number;
    target: number;
  } | null>(null);
  useLayoutEffect(
    () => () => {
      drag.current?.releaseScroll?.();
      drag.current = null;
    },
    [],
  );
  const stop = () => {
    const previous = drag.current;
    drag.current = null;
    previous?.releaseScroll?.();
    setPreview(null);
  };
  const track = (event: GestureResponderEvent, commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    const pointer = event.nativeEvent;
    if (
      disabled ||
      selection !== current.selection ||
      pointer.touches.length > 1 ||
      pointer.identifier !== current.pointerId ||
      !Number.isFinite(pointer.pageY)
    ) {
      stop();
      return;
    }
    const start = current.centers[current.from]!;
    const center = Math.max(
      current.centers[0]!,
      Math.min(
        current.centers[current.centers.length - 1]!,
        start + pointer.pageY - current.origin,
      ),
    );
    let target = current.from;
    for (const [index, boundary] of current.centers.entries()) {
      if (index < current.from && center <= boundary && target === current.from)
        target = index;
      if (index > current.from && center >= boundary) target = index;
    }
    if (commit) {
      stop();
      if (target !== current.from) onMove(current.metric, target);
    } else {
      setPreview({ metric: current.metric, delta: center - start, target });
    }
  };
  const begin = (
    metric: OverviewMetricChoice,
    event: GestureResponderEvent,
  ) => {
    const pointer = event.nativeEvent;
    if (drag.current || disabled || pointer.touches.length !== 1) return false;
    const centers = selection.map(item => {
      const row = measured.current.get(item);
      return row && row.height > 0 ? row.y + row.height / 2 : NaN;
    });
    const from = selection.indexOf(metric);
    if (
      from < 0 ||
      !Number.isFinite(pointer.pageY) ||
      centers.some(
        (center, index) =>
          !Number.isFinite(center) ||
          (index > 0 && center <= centers[index - 1]!),
      )
    )
      return false;
    drag.current = {
      metric,
      origin: pointer.pageY,
      pointerId: pointer.identifier,
      from,
      centers,
      selection,
      releaseScroll: suspendScroll?.(),
    };
    setPreview({ metric, delta: 0, target: from });
    // RN Fabric uses the grant return value to mark the active native responder.
    return true;
  };
  const measure = (metric: OverviewMetricChoice, row: LayoutRectangle) => {
    const previous = measured.current.get(metric);
    measured.current.set(metric, row);
    // Invalidate the captured layout if Dynamic Type/rotation moves any target.
    if (
      drag.current &&
      (previous?.y !== row.y || previous?.height !== row.height)
    )
      stop();
  };
  return {
    begin,
    isActive: () => drag.current !== null,
    measure,
    move: (event: GestureResponderEvent) => track(event, false),
    release: (event: GestureResponderEvent) => track(event, true),
    finish: stop,
    preview,
  };
}
