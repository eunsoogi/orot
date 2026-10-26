import { useContext, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  SafeAreaInsetsContext,
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
  const layout = resolveNavigationRootLayout(geometry);
  const safeAreaInsets = useContext(SafeAreaInsetsContext);
  const occlusionInput = {
    placement: layout.placement,
    reservedRightWidth:
      layout.placement === 'right' ? layout.reservedRightWidth : 0,
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
          viewportOcclusion.viewportInsets.bottom,
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
            bottom: 0,
            left: 0,
            position: 'absolute' as const,
            paddingBottom: occlusion.viewportInsets.bottom,
            right: occlusion.viewportInsets.right,
            top: 0,
          },
        ]
      : styles.fill;
  return (
    <NavigationRootLayoutContext.Provider value={layout}>
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
            {childHandlesSafeArea ? (
              <View style={styles.fill}>{children}</View>
            ) : (
              <SafeAreaView
                // The rail reservation owns right and bottom clearance; this wrapper keeps the remaining edges.
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
    </NavigationRootLayoutContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { bottom: 0, left: 0, position: 'absolute', right: 0, zIndex: 1 },
});
