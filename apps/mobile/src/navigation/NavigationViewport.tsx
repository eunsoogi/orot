import {
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { NavigationOcclusionContext } from './useNavigationContentInset';
import { useNavigationGeometry } from './NavigationGeometryProvider';
import {
  measureNavigationBottomOcclusion,
  resolveNavigationOcclusion,
  type NavigationLayoutFrame,
} from './navigationLayout';
import {
  NavigationRootLayoutContext,
  resolveNavigationRootLayout,
} from './navigationRootLayout';
import {
  NavigationContentFrameContext,
  resolveNavigationContentFrame,
} from './navigationContentFrame';
import { observeNavigationTest } from './navigationTestObservation';
import type { NavigationGeometryRect } from './navigationGeometry';
import { NavigationOverlayLayoutContext } from './navigationOverlayLayout';

/** Shares shell geometry with the bar, preserves routes beside reserved lanes, and separates scroll-only action overlap. */
export function NavigationViewport({
  children,
  actionBar,
  childHandlesSafeArea,
}: {
  readonly children: ReactNode;
  readonly actionBar: ReactNode;
  readonly childHandlesSafeArea: boolean;
}) {
  const [contentFrame, setContentFrame] =
    useState<NavigationLayoutFrame | null>(null);
  const [actionFrame, setActionFrame] = useState<NavigationGeometryRect | null>(
    null,
  );
  const [viewportBounds, setViewportBounds] =
    useState<NavigationGeometryRect | null>(null);
  const geometry = useNavigationGeometry();
  const layout = useMemo(
    () => resolveNavigationRootLayout(geometry),
    [geometry],
  );
  const sharedFrame = useMemo(
    () =>
      resolveNavigationContentFrame(
        geometry,
        layout,
        viewportBounds
          ? {
              ...viewportBounds,
              x:
                viewportBounds.x +
                (geometry?.viewportBounds?.x ?? geometry?.windowBounds.x ?? 0),
              y:
                viewportBounds.y +
                (geometry?.viewportBounds?.y ?? geometry?.windowBounds.y ?? 0),
            }
          : null,
      ),
    [geometry, layout, viewportBounds],
  );
  useEffect(() => {
    if (sharedFrame)
      observeNavigationTest('navigation-content-frame', {
        frame: JSON.stringify(sharedFrame),
      });
  }, [sharedFrame]);
  const safeAreaInsets = useContext(SafeAreaInsetsContext);
  const visibleSide =
    sharedFrame?.side ??
    (layout.placement === 'right' ? (layout.railSide ?? 'right') : 'bottom');
  const viewport = sharedFrame?.viewportFrame;
  const available = sharedFrame?.availableContentFrame;
  const consumed =
    viewport && available
      ? {
          top: available.y - viewport.y,
          left: available.x - viewport.x,
          right: viewport.x + viewport.width - available.x - available.width,
          bottom: viewport.y + viewport.height - available.y - available.height,
        }
      : null;
  const occlusionInput = {
    placement:
      visibleSide === 'bottom' ? ('bottom' as const) : ('right' as const),
    reservedRightWidth:
      consumed?.right ??
      (layout.placement === 'right' ? layout.reservedRightWidth : 0),
    reservedLeftWidth: consumed?.left ?? 0,
    systemBottomInset: consumed?.bottom ?? 0,
    systemInsets: {
      top: safeAreaInsets?.top ?? 0,
      right: safeAreaInsets?.right ?? 0,
      bottom: safeAreaInsets?.bottom ?? 0,
      left: safeAreaInsets?.left ?? 0,
    },
  };
  const viewportOcclusion = resolveNavigationOcclusion({
    ...occlusionInput,
    measuredBottomActionOcclusion: null,
  });
  const measuredBottomActionOcclusion =
    contentFrame && actionFrame
      ? measureNavigationBottomOcclusion(
          contentFrame,
          actionFrame,
          consumed ? 0 : viewportOcclusion.viewportInsets.bottom,
        )
      : null;
  const occlusion = resolveNavigationOcclusion({
    ...occlusionInput,
    measuredBottomActionOcclusion,
  });
  // The measured parent shrinks with KeyboardAvoidingView. Derive its edge clearance once,
  // rather than deducting the full-window home area again above an already visible keyboard.
  const contentRegionStyle = consumed
    ? [
        styles.fill,
        {
          position: 'absolute' as const,
          ...consumed,
        },
      ]
    : styles.fill;
  return (
    <NavigationRootLayoutContext.Provider value={layout}>
      <NavigationContentFrameContext.Provider value={sharedFrame}>
        <NavigationOcclusionContext.Provider value={occlusion}>
          <View
            style={styles.fill}
            onLayout={({ nativeEvent }) =>
              setViewportBounds(nativeEvent.layout)
            }
            testID="navigation-visible-viewport"
          >
            <View
              onLayout={({ nativeEvent }) =>
                setContentFrame({
                  y: nativeEvent.layout.y,
                  height: nativeEvent.layout.height,
                })
              }
              style={contentRegionStyle}
              testID="navigation-content-region"
            >
              {/* The contracted native provider reports only edges not already consumed by this frame. */}
              <SafeAreaProvider
                style={styles.fill}
                initialMetrics={{
                  frame: sharedFrame?.availableContentFrame ?? {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                  },
                  insets: consumed
                    ? { top: 0, right: 0, bottom: 0, left: 0 }
                    : (safeAreaInsets ?? {
                        top: 0,
                        right: 0,
                        bottom: 0,
                        left: 0,
                      }),
                }}
              >
                {childHandlesSafeArea ? (
                  <View style={styles.fill}>{children}</View>
                ) : (
                  <SafeAreaView
                    // The nested provider reports only unconsumed edges; never repeat the shell reservation.
                    edges={['top', 'right', 'left']}
                    style={styles.fill}
                    testID="navigation-safe-area-content"
                  >
                    {children}
                  </SafeAreaView>
                )}
              </SafeAreaProvider>
            </View>
            <View
              pointerEvents="box-none"
              style={styles.overlay}
              testID="navigation-action-bar-overlay"
              onLayout={({ nativeEvent }) => setActionFrame(nativeEvent.layout)}
            >
              <NavigationOverlayLayoutContext.Provider value={actionFrame}>
                {actionBar}
              </NavigationOverlayLayoutContext.Provider>
            </View>
          </View>
        </NavigationOcclusionContext.Provider>
      </NavigationContentFrameContext.Provider>
    </NavigationRootLayoutContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { bottom: 0, left: 0, position: 'absolute', right: 0, zIndex: 1 },
});
