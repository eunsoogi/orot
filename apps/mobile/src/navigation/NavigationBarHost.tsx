import type { ReactNode } from 'react';
import {
  Text,
  View,
  useColorScheme,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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
  status,
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
  status?: 'pending' | 'unfit';
}) {
  const isDark = useColorScheme() === 'dark';
  const content = (
    <View
      pointerEvents="box-none"
      testID={singleRow ? 'navigation-bottom-single-row' : undefined}
      style={
        status
          ? styles.statusHost
          : isRightRail
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
      <View
        pointerEvents={status ? 'none' : 'box-none'}
        accessibilityElementsHidden={Boolean(status)}
        importantForAccessibility={status ? 'no-hide-descendants' : 'auto'}
        style={
          status
            ? styles.measurementHost
            : isRightRail
              ? styles.fill
              : undefined
        }
      >
        {surfacePosition}
      </View>
      {status ? (
        <Text
          accessibilityRole={status === 'unfit' ? 'alert' : 'progressbar'}
          style={[styles.statusText, isDark && styles.statusTextDark]}
        >
          {status === 'unfit'
            ? '이 화면에 필요한 탐색 동작을 표시할 공간이 부족해요.'
            : '탐색 동작을 준비하고 있어요.'}
        </Text>
      ) : null}
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
