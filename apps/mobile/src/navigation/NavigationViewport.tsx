import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContentInsetContext } from './useNavigationContentInset';
import { useNavigationGeometry } from './NavigationGeometryProvider';
import {
  NavigationRootLayoutContext,
  resolveNavigationRootLayout,
} from './navigationRootLayout';

/** Shares one geometry result with the bar and preserves mounted routes beside a reserved right lane. */
export function NavigationViewport({
  children,
  actionBar,
  childHandlesSafeArea,
}: {
  readonly children: ReactNode;
  readonly actionBar: ReactNode;
  readonly childHandlesSafeArea: boolean;
}) {
  const [barHeight, setBarHeight] = useState<number | null>(null);
  const geometry = useNavigationGeometry();
  const layout = resolveNavigationRootLayout(geometry);
  const contentRegionStyle =
    layout.placement === 'right'
      ? [
          styles.fill,
          {
            bottom: 0,
            left: 0,
            position: 'absolute' as const,
            paddingBottom: layout.systemBottomInset,
            right: layout.reservedRightWidth,
            top: 0,
          },
        ]
      : styles.fill;
  return (
    <NavigationRootLayoutContext.Provider value={layout}>
      <NavigationContentInsetContext.Provider value={barHeight}>
        <View style={styles.fill}>
          <View style={contentRegionStyle} testID="navigation-content-region">
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
              setBarHeight(nativeEvent.layout.height)
            }
          >
            {actionBar}
          </View>
        </View>
      </NavigationContentInsetContext.Provider>
    </NavigationRootLayoutContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { bottom: 0, left: 0, position: 'absolute', right: 0, zIndex: 1 },
});
