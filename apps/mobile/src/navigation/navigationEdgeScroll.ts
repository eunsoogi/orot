import { I18nManager, type ScrollViewProps } from 'react-native';
import { useNavigationRightScrollEdge } from './navigationScrollEdge';
import { useNavigationOcclusion } from './useNavigationContentInset';

type VerticalScrollOptions = {
  /** Omit only for whole-route owners. An unmeasured/split pane stays local. */
  readonly ownerWidth?: number;
  readonly trailingPadding?: number;
  readonly indicatorTop?: number;
  readonly indicatorBottom?: number;
};

/** UIKit insets are physical. Use logical start under RTL for Yoga's right edge. */
export function navigationPhysicalRightLayout(
  distance: number,
  padding: number,
  rtl = I18nManager.isRTL,
) {
  return rtl
    ? {
        scrollViewStyle: { marginStart: -distance },
        contentStyle: { paddingStart: padding },
        shieldAnchor: { start: 0 },
      }
    : {
        scrollViewStyle: { marginRight: -distance },
        contentStyle: { paddingRight: padding },
        shieldAnchor: { right: 0 },
      };
}

function ownsFullLane(ownerWidth: number | undefined, contentWidth: number) {
  return (
    ownerWidth === undefined ||
    (Number.isFinite(ownerWidth) &&
      ownerWidth > 0 &&
      Math.abs(ownerWidth - contentWidth) <= 1)
  );
}

/** Lends only visual viewport width. The inverse inset keeps ordinary rows,
 * keyboard clearance, native scroll position, and hit targets in their original lane. */
export function useNavigationEdgeVerticalScroll({
  ownerWidth,
  trailingPadding = 0,
  indicatorTop = 0,
  indicatorBottom = 0,
}: VerticalScrollOptions = {}) {
  const edge = useNavigationRightScrollEdge();
  const bottom = useNavigationOcclusion().scrollContentInsets.bottom;
  const right = ownsFullLane(ownerWidth, edge.contentWidth) ? edge.right : 0;
  const indicatorProps: Pick<
    ScrollViewProps,
    'automaticallyAdjustsScrollIndicatorInsets' | 'scrollIndicatorInsets'
  > = right
    ? {
        automaticallyAdjustsScrollIndicatorInsets: false,
        scrollIndicatorInsets: {
          top: Math.max(indicatorTop, edge.top),
          right: 0,
          left: 0,
          bottom: Math.max(indicatorBottom, bottom),
        },
      }
    : {};
  const geometry = right
    ? navigationPhysicalRightLayout(right, trailingPadding + right)
    : undefined;
  return {
    scrollViewStyle: geometry?.scrollViewStyle,
    contentStyle: geometry?.contentStyle,
    indicatorProps,
  };
}

/** Menus explicitly opt into the rail; their full width must be measured by
 * the parent before its own ordinary trailing gutter is deducted. */
export function useNavigationEdgeMenu({
  ownerWidth,
  trailingGutter = 0,
}: {
  readonly ownerWidth: number;
  readonly trailingGutter?: number;
}) {
  const edge = useNavigationRightScrollEdge();
  const right = ownsFullLane(ownerWidth, edge.contentWidth) ? edge.right : 0;
  return {
    rightBleed: right ? right + trailingGutter : 0,
    touchClearance: right,
  };
}
