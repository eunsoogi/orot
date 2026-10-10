import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContentInsetContext } from './useNavigationContentInset';

/** Shares the actual floating-bar obstruction with every page scroller, without shortening its viewport. */
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
  return (
    <NavigationContentInsetContext.Provider value={barHeight}>
      <View style={styles.fill}>
        {childHandlesSafeArea ? (
          <View style={styles.fill}>{children}</View>
        ) : (
          <SafeAreaView edges={['top', 'right', 'left']} style={styles.fill}>
            {children}
          </SafeAreaView>
        )}
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
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { bottom: 0, left: 0, position: 'absolute', right: 0, zIndex: 1 },
});
