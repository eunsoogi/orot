import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
import { useNavigationGeometry } from '../navigation/NavigationGeometryProvider';
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
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const hasSecondary = secondary !== undefined && secondary !== null;
  const plan = useMemo(
    () =>
      resolveAdaptiveColumns({
        windowWidth: width,
        fontScale,
        systemInsets: occlusion.systemInsets,
        viewportInsets: occlusion.viewportInsets,
        measuredWidth,
        safeAreaFrame: geometry?.safeAreaFrame,
        usableRegions: geometry?.usableRegions,
        hasNativeDivision: geometry?.reservedRegions.some(
          region => region.isActive && region.kind === 'division',
        ),
        hasNativeOcclusion: geometry?.reservedRegions.some(
          region => region.isActive && region.kind === 'occlusion',
        ),
        hasSecondary,
      }),
    [fontScale, geometry, hasSecondary, measuredWidth, occlusion, width],
  );

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
      onLayout={({ nativeEvent }) => {
        const nextWidth = nativeEvent.layout.width;
        if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
        setMeasuredWidth(previous =>
          previous !== null && Math.abs(previous - nextWidth) < 0.5
            ? previous
            : nextWidth,
        );
      }}
      style={rootStyle}
      testID={testID}
    >
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
  );
}
