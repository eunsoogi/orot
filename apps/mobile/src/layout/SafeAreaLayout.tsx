import type { ReactNode } from 'react';
import {
  I18nManager,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
  useSafeAreaFrame,
} from 'react-native-safe-area-context';
import { navigationPhysicalRightLayout } from '../navigation/navigationEdgeScroll';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import { appColors } from './appColors';

interface SafeAreaLayoutProps {
  children: ReactNode;
  scrollable?: boolean;
  /** A standalone owner can lend its physical right safe area to the indicator only. */
  outerScrollIndicator?: boolean;
  /** Let a portrait modal use the horizontal lane below its protected top region. */
  horizontalScrollContent?: boolean;
  scrollContentStyle?: StyleProp<ViewStyle>;
  scrollTestID?: string;
}

/** Standalone controls keep safe bounds; standalone scrolling moves that bound to end clearance. */
export default function SafeAreaLayout(props: SafeAreaLayoutProps) {
  return (
    <SafeAreaProvider style={styles.fill}>
      {props.scrollable && props.horizontalScrollContent ? (
        <HorizontalContent {...props} />
      ) : (
        <SafeAreaContent {...props} />
      )}
    </SafeAreaProvider>
  );
}

function HorizontalContent(props: SafeAreaLayoutProps) {
  const { width, height } = useSafeAreaFrame();
  // In landscape a real side obstruction may extend below the top safe area.
  // Keep those insets inside the scroll canvas; do not shrink its viewport.
  const reserveSides = width <= 0 || height <= 0 || width >= height;
  return <SafeAreaContent {...props} reserveSides={reserveSides} />;
}

function SafeAreaContent({
  children,
  scrollable = false,
  outerScrollIndicator = false,
  horizontalScrollContent = false,
  reserveSides = true,
  scrollContentStyle,
  scrollTestID = 'safe-area-scroll',
}: SafeAreaLayoutProps & { reserveSides?: boolean }) {
  const { bottom, left, right } = useSafeAreaInsets();
  const content = StyleSheet.flatten(scrollContentStyle);
  const endGap =
    content?.paddingBottom ??
    content?.paddingVertical ??
    content?.padding ??
    NAVIGATION_CONTENT_GAP;
  const contentStyle = [
    styles.scrollContent,
    scrollContentStyle,
    {
      paddingBottom:
        bottom + (typeof endGap === 'number' ? endGap : NAVIGATION_CONTENT_GAP),
    },
  ];
  // This native modal has its own safe area, not the navigation shell's lane.
  // Put the readable right inset outside the centered editor so its width and
  // keyboard-safe bottom gap are identical before and after viewport expansion.
  const edge = horizontalScrollContent
    ? {
        paddingStart: reserveSides ? (I18nManager.isRTL ? right : left) : 0,
        paddingEnd: reserveSides ? (I18nManager.isRTL ? left : right) : 0,
      }
    : outerScrollIndicator
      ? navigationPhysicalRightLayout(0, right).contentStyle
      : undefined;
  return (
    <SafeAreaView
      edges={
        scrollable
          ? horizontalScrollContent
            ? ['top']
            : outerScrollIndicator
              ? ['top', 'left']
              : ['top', 'right', 'left']
          : ['top', 'right', 'bottom', 'left']
      }
      style={styles.fill}
      testID="safe-area-root"
    >
      {scrollable ? (
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={
            edge ? [styles.scrollContent, edge] : contentStyle
          }
          {...(edge
            ? {
                automaticallyAdjustsScrollIndicatorInsets: false,
                scrollIndicatorInsets: { top: 0, right: 0, bottom, left: 0 },
              }
            : {})}
          keyboardShouldPersistTaps="handled"
          style={styles.fill}
          testID={scrollTestID}
        >
          {edge ? (
            <View
              style={contentStyle}
              testID="safe-area-scroll-readable-content"
            >
              {children}
            </View>
          ) : (
            children
          )}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  fill: { backgroundColor: appColors.background, flex: 1 },
  scrollContent: { flexGrow: 1 },
});
