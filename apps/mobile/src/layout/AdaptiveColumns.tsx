import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HostInstance } from 'react-native';
import type { ViewStyle } from 'react-native';
import { useNavigationGeometry } from '../navigation/NavigationGeometryProvider';
import { useNavigationContentFrame } from '../navigation/navigationContentFrame';
import { observeNavigationTest } from '../navigation/navigationTestObservation';
import { useNavigationOcclusion } from '../navigation/useNavigationContentInset';
import {
  resolveAdaptiveColumns,
  type AdaptiveColumnsPlan,
} from './adaptiveColumnsPlan';

export interface AdaptiveColumnsProps {
  readonly primary: ReactNode;
  readonly secondary?: ReactNode;
  readonly routeKey?: string;
  readonly active?: boolean;
  readonly testID?: string;
}

function createPanelStyle(
  columns: AdaptiveColumnsPlan['columns'],
  width: number,
) {
  return {
    flexGrow: columns === 1 ? 1 : 0,
    minWidth: 0,
    minHeight: 0,
    width,
  };
}

/** Reflows stable route-owned panels from measured space, native geometry, and text scale. */
export function AdaptiveColumns({
  primary,
  secondary,
  routeKey,
  active = true,
  testID = 'adaptive-columns',
}: AdaptiveColumnsProps) {
  const { width, fontScale } = useWindowDimensions();
  const occlusion = useNavigationOcclusion();
  const geometry = useNavigationGeometry();
  const readableFrame =
    useNavigationContentFrame()?.availableContentFrame ??
    geometry?.safeAreaFrame;
  const hostRef = useRef<HostInstance | null>(null);
  const [measuredBounds, setMeasuredBounds] = useState<{
    readonly x: number;
    readonly width: number;
  } | null>(null);
  const hasSecondary = secondary !== undefined && secondary !== null;
  const measureHost = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;

    // Native geometry uses window coordinates, so local layout offsets are not interchangeable.
    host.measureInWindow((x, _y, nextWidth) => {
      if (!Number.isFinite(x) || !Number.isFinite(nextWidth) || nextWidth <= 0)
        return;
      setMeasuredBounds(previous =>
        previous !== null &&
        Math.abs(previous.x - x) < 0.5 &&
        Math.abs(previous.width - nextWidth) < 0.5
          ? previous
          : { x, width: nextWidth },
      );
    });
  }, []);
  const plan = useMemo(
    () =>
      resolveAdaptiveColumns({
        windowWidth: width,
        fontScale,
        systemInsets: occlusion.systemInsets,
        viewportInsets: occlusion.viewportInsets,
        measuredBounds,
        safeAreaFrame: geometry?.safeAreaFrame,
        usableRegions: geometry?.usableRegions,
        hasNativeDivision: geometry?.reservedRegions.some(
          region => region.isActive && region.kind === 'division',
        ),
        hasNativeOcclusion: geometry?.reservedRegions.some(region => {
          if (!region.isActive || region.kind !== 'occlusion') return false;
          if (!readableFrame) return true;
          // System lanes already consumed by the shell cannot obstruct these panels again.
          // UIKit's frame already includes its margins; intersect that physical frame exactly once.
          const left = Math.max(
            readableFrame.x,
            measuredBounds?.x ?? readableFrame.x,
          );
          const right = Math.min(
            readableFrame.x + readableFrame.width,
            measuredBounds ? measuredBounds.x + measuredBounds.width : Infinity,
          );
          return (
            region.frame.x < right &&
            region.frame.x + region.frame.width > left &&
            region.frame.y < readableFrame.y + readableFrame.height &&
            region.frame.y + region.frame.height > readableFrame.y
          );
        }),
        hasSecondary,
      }),
    [
      fontScale,
      geometry,
      hasSecondary,
      measuredBounds,
      occlusion,
      readableFrame,
      width,
    ],
  );

  useEffect(() => {
    measureHost();
  }, [
    fontScale,
    geometry,
    measureHost,
    occlusion.systemInsets.left,
    occlusion.systemInsets.right,
    occlusion.viewportInsets.left,
    occlusion.viewportInsets.right,
    width,
  ]);

  useEffect(() => {
    if (!routeKey) return;
    observeNavigationTest('adaptive-columns-layout', {
      routeKey,
      active,
      width: String(plan.contentWidth),
      columns: String(plan.columns),
      fontScale: String(fontScale),
    });
  }, [active, fontScale, plan.columns, plan.contentWidth, routeKey]);

  const routeWidth = Math.max(0, plan.contentWidth - plan.leadingInset);
  const rootStyle = useMemo<ViewStyle>(
    () => ({
      flexGrow: 1,
      minWidth: 0,
      minHeight: 0,
      flexDirection: plan.columns === 2 ? 'row' : 'column',
      width: routeWidth,
      marginStart: plan.leadingInset,
      columnGap: plan.columns === 2 ? plan.columnGap : 0,
      rowGap: plan.columns === 1 ? plan.rowGap : 0,
    }),
    [plan, routeWidth],
  );
  const primaryPanelStyle = useMemo(
    () => createPanelStyle(plan.columns, plan.primaryWidth),
    [plan.columns, plan.primaryWidth],
  );
  const secondaryPanelStyle = useMemo(
    () => createPanelStyle(plan.columns, plan.secondaryWidth),
    [plan.columns, plan.secondaryWidth],
  );

  return (
    <View
      onLayout={measureHost}
      ref={hostRef}
      style={styles.measurementHost}
      testID={`${testID}-host`}
    >
      <View style={rootStyle} testID={testID}>
        {/* Stable wrappers keep each panel mounted while only the axis and widths change. */}
        <View style={primaryPanelStyle} testID={`${testID}-primary`}>
          {primary}
        </View>
        {hasSecondary ? (
          <View style={secondaryPanelStyle} testID={`${testID}-secondary`}>
            {secondary}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  measurementHost: { flexGrow: 1, minWidth: 0, minHeight: 0 },
});
