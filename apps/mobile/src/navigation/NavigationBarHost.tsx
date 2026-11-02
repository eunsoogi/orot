import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { navigationActionBarStyles as styles } from './navigationActionBarStyles';

/** Hosts the measurable bottom row and keeps the portal-mounted rail in its lane. */
export function NavigationBarHost({
  hostStyle,
  isRightRail,
  keyboardVisible,
  hasRootTabs,
  pageLeft,
  pageDock,
  pageWidth,
  safeAreaHandledByParent,
  singleRow,
  surfacePosition,
}: {
  hostStyle: StyleProp<ViewStyle>;
  isRightRail: boolean;
  keyboardVisible: boolean;
  hasRootTabs: boolean;
  pageLeft: number;
  pageDock: ReactNode;
  pageWidth: number;
  safeAreaHandledByParent: boolean;
  singleRow: boolean;
  surfacePosition: ReactNode;
}) {
  const content = (
    <View
      pointerEvents="box-none"
      testID={singleRow ? 'navigation-bottom-single-row' : undefined}
      style={
        isRightRail
          ? styles.fill
          : singleRow && hasRootTabs
            ? styles.bottomRow
            : undefined
      }
    >
      {pageDock ? (
        <View
          pointerEvents="box-none"
          style={
            isRightRail
              ? styles.pageRail
              : singleRow
                ? hasRootTabs
                  ? { width: pageWidth }
                  : [styles.centeredPage, { left: pageLeft, width: pageWidth }]
                : undefined
          }
        >
          {pageDock}
        </View>
      ) : null}
      {surfacePosition}
    </View>
  );
  return (
    <View pointerEvents="box-none" style={styles.host}>
      {safeAreaHandledByParent ? (
        <View
          pointerEvents="box-none"
          style={hostStyle}
          testID={isRightRail ? 'navigation-right-rail-host' : undefined}
        >
          {content}
        </View>
      ) : (
        <SafeAreaView
          edges={isRightRail || keyboardVisible ? [] : ['bottom']}
          pointerEvents="box-none"
          style={hostStyle}
          testID={
            isRightRail
              ? 'navigation-right-rail-host'
              : 'navigation-action-bar-safe-area'
          }
        >
          {content}
        </SafeAreaView>
      )}
    </View>
  );
}
