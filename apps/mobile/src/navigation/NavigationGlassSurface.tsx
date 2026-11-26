import { useContext, useState, type ReactNode } from 'react';
import { useNavigationGeometry } from './NavigationGeometryProvider';
import type { NavigationGeometryRect } from './navigationGeometry';
import { NavigationOverlayLayoutContext } from './navigationOverlayLayout';
import {
  NAVIGATION_SURFACE_HEIGHT,
  ROOT_TAB_SURFACE_HEIGHT,
} from './navigationLayout';
import {
  type NativeSyntheticEvent,
  Platform,
  requireNativeComponent,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

export interface NavigationGlassAction {
  readonly id: string;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly testID: string;
  readonly systemImageName?: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly primary?: boolean;
  readonly selected?: boolean;
  /** Keeps root-only sizing and selected glass from leaking into contextual actions. */
  readonly rootTab?: boolean;
  readonly showsTitleWithSystemImage?: boolean;
  readonly titleBelowImage?: boolean;
  readonly layoutWidth?: number;
}

export interface NavigationGlassActionEvent {
  readonly id: string;
}

export type NavigationGlassActionEventHandler = (
  event: NativeSyntheticEvent<NavigationGlassActionEvent>,
) => void;

export interface NavigationGlassSurfaceProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID: string;
  readonly actions?: readonly NavigationGlassAction[];
  readonly onAction?: NavigationGlassActionEventHandler;
  readonly layoutMode?: 'bottom' | 'left' | 'right';
  readonly railTopInset?: number;
  readonly railBackTopInset?: number;
  readonly railBottomInset?: number;
  readonly railRightInset?: number;
  /** Explicit window extent after keyboard avoidance, independent of React host bounds. */
  readonly railAvailableHeight?: number;
  readonly bottomHeight?: number;
  readonly isPageDock?: boolean;
  readonly pageMetricsRequest?: {
    readonly revision: string;
    readonly actions: readonly NavigationGlassAction[];
  };
  readonly onPageMetrics?: (
    event: NativeSyntheticEvent<{
      revision: string;
      width: number;
      widths: number[];
      baselineWidths?: number[];
      heights: number[];
      category?: string;
    }>,
  ) => void;
}

interface NavigationGlassNativeProps extends ViewProps {
  readonly geometryLayoutRevision?: string;
  readonly actions?: readonly NavigationGlassAction[];
  readonly onAction?: NavigationGlassActionEventHandler;
  readonly layoutMode?: 'bottom' | 'left' | 'right';
  readonly railTopInset?: number;
  readonly railBackTopInset?: number;
  readonly railBottomInset?: number;
  readonly railRightInset?: number;
  readonly railAvailableHeight?: number;
  readonly bottomHeight?: number;
  readonly isPageDock?: boolean;
  readonly pageMetricsRequest?: NavigationGlassSurfaceProps['pageMetricsRequest'];
  readonly onPageMetrics?: NavigationGlassSurfaceProps['onPageMetrics'];
}

const NativeNavigationGlassSurface =
  Platform.OS === 'ios'
    ? requireNativeComponent<NavigationGlassNativeProps>('NavigationGlassView')
    : null;

const coordinates = ({ x, y, width, height }: NavigationGeometryRect) => [
  x,
  y,
  width,
  height,
];

export function NavigationGlassSurface({
  actions = [],
  children,
  layoutMode,
  onAction,
  railBottomInset,
  railRightInset,
  railTopInset,
  railBackTopInset,
  railAvailableHeight,
  bottomHeight,
  isPageDock,
  pageMetricsRequest,
  onPageMetrics,
  style,
  testID,
}: NavigationGlassSurfaceProps) {
  const overlay = useContext(NavigationOverlayLayoutContext);
  const geometry = useNavigationGeometry();
  // The overlay commits its own position before any measurement request. An
  // admitted right rail also needs to retry native window containment when the
  // physical viewport recovers but its local overlay hasn't moved. Exclude
  // measured navigation frames so publishing a Back frame cannot self-invalidate.
  const overlayFrame = overlay && coordinates(overlay);
  const physicalFrames =
    layoutMode === 'right' && geometry
      ? [
          coordinates(geometry.windowBounds),
          coordinates(geometry.viewportBounds ?? geometry.windowBounds),
        ]
      : undefined;
  const geometryLayoutRevision = overlayFrame
    ? JSON.stringify(
        physicalFrames ? [overlayFrame, ...physicalFrames] : overlayFrame,
      )
    : undefined;
  const isDarkAppearance = useColorScheme() === 'dark';
  const hasRootTabs = actions.some(action => action.rootTab);
  const { fontScale } = useWindowDimensions();
  const revision = JSON.stringify([fontScale, actions]);
  const [ownMetrics, setOwnMetrics] = useState<{
    revision: string;
    height: number;
  }>();
  const isBottom = layoutMode === undefined || layoutMode === 'bottom';
  const measuredHeight =
    ownMetrics?.revision === revision ? ownMetrics.height : 0;
  const resolvedHeight = Math.max(
    hasRootTabs ? ROOT_TAB_SURFACE_HEIGHT : NAVIGATION_SURFACE_HEIGHT,
    bottomHeight ?? 0,
    measuredHeight,
  );
  const ownRequest =
    isBottom && !pageMetricsRequest ? { revision, actions } : undefined;

  if (NativeNavigationGlassSurface) {
    return (
      <NativeNavigationGlassSurface
        geometryLayoutRevision={geometryLayoutRevision}
        isPageDock={isPageDock}
        pageMetricsRequest={pageMetricsRequest ?? ownRequest}
        onPageMetrics={
          pageMetricsRequest
            ? onPageMetrics
            : ({ nativeEvent }) => {
                if (
                  nativeEvent.revision !== revision ||
                  nativeEvent.heights?.length !== actions.length ||
                  !nativeEvent.heights?.every(
                    value => Number.isFinite(value) && value >= 0,
                  )
                )
                  return;
                const height = Math.max(0, ...nativeEvent.heights);
                setOwnMetrics(current =>
                  current?.revision === revision && current.height === height
                    ? current
                    : { revision, height },
                );
              }
        }
        actions={actions}
        layoutMode={layoutMode}
        onAction={onAction}
        railBottomInset={railBottomInset}
        railRightInset={railRightInset}
        railTopInset={railTopInset}
        railBackTopInset={railBackTopInset}
        railAvailableHeight={railAvailableHeight}
        bottomHeight={isBottom ? resolvedHeight : undefined}
        style={[
          styles.surface,
          hasRootTabs && styles.rootTabSurface,
          isBottom ? { height: resolvedHeight } : undefined,
          style,
        ]}
        testID={testID}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        isDarkAppearance && styles.darkFallback,
        hasRootTabs && styles.rootTabFallback,
        style,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    flexShrink: 0,
    height: NAVIGATION_SURFACE_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  rootTabSurface: { height: ROOT_TAB_SURFACE_HEIGHT },
  fallback: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  rootTabFallback: { paddingBottom: 4, paddingTop: 4 },
  darkFallback: { backgroundColor: '#191f28' },
});
