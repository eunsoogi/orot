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
  const [actionFrame, setActionFrame] = useState<NavigationLayoutFrame | null>(
    null,
  );
  const geometry = useNavigationGeometry();
  const layout = useMemo(
    () => resolveNavigationRootLayout(geometry),
    [geometry],
  );
  const sharedFrame = useMemo(
    () => resolveNavigationContentFrame(geometry, layout),
    [geometry, layout],
  );
  useEffect(() => {
    if (sharedFrame)
      observeNavigationTest('navigation-content-frame', {
        frame: JSON.stringify(sharedFrame),
      });
  }, [sharedFrame]);
  const safeAreaInsets = useContext(SafeAreaInsetsContext);
  const occlusionInput = {
    placement: layout.placement,
    reservedRightWidth:
      layout.placement === 'right' ? layout.reservedRightWidth : 0,
    reservedLeftWidth:
      layout.placement === 'right' ? (layout.reservedLeftWidth ?? 0) : 0,
    systemBottomInset:
      layout.placement === 'right' ? layout.systemBottomInset : 0,
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
          layout.placement === 'right'
            ? 0
            : viewportOcclusion.viewportInsets.bottom,
        )
      : null;
  const occlusion = resolveNavigationOcclusion({
    ...occlusionInput,
    measuredBottomActionOcclusion,
  });
  const contentRegionStyle =
    layout.placement === 'right'
      ? [
          styles.fill,
          {
            bottom: occlusion.viewportInsets.bottom,
            left: sharedFrame
              ? sharedFrame.availableContentFrame.x -
                sharedFrame.viewportFrame.x
              : occlusion.viewportInsets.left,
            position: 'absolute' as const,
            right: occlusion.viewportInsets.right,
            top: sharedFrame
              ? sharedFrame.availableContentFrame.y -
                sharedFrame.viewportFrame.y
              : 0,
          },
        ]
      : styles.fill;
  return (
    <NavigationRootLayoutContext.Provider value={layout}>
      <NavigationContentFrameContext.Provider value={sharedFrame}>
        <NavigationOcclusionContext.Provider value={occlusion}>
          <View style={styles.fill}>
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
                  insets:
                    layout.placement === 'right'
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
                    edges={
                      layout.placement === 'right'
                        ? ['top', 'left']
                        : ['top', 'right', 'left']
                    }
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
              onLayout={({ nativeEvent }) =>
                setActionFrame({
                  y: nativeEvent.layout.y,
                  height: nativeEvent.layout.height,
                })
              }
            >
              {actionBar}
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
