import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import { appColors } from './appColors';

interface SafeAreaLayoutProps {
  children: ReactNode;
  scrollable?: boolean;
  scrollContentStyle?: StyleProp<ViewStyle>;
  scrollTestID?: string;
}

/** Standalone controls keep safe bounds; standalone scrolling moves that bound to end clearance. */
export default function SafeAreaLayout(props: SafeAreaLayoutProps) {
  return (
    <SafeAreaProvider style={styles.fill}>
      <SafeAreaContent {...props} />
    </SafeAreaProvider>
  );
}

function SafeAreaContent({
  children,
  scrollable = false,
  scrollContentStyle,
  scrollTestID = 'safe-area-scroll',
}: SafeAreaLayoutProps) {
  const { bottom } = useSafeAreaInsets();
  const content = StyleSheet.flatten(scrollContentStyle);
  const endGap =
    content?.paddingBottom ??
    content?.paddingVertical ??
    content?.padding ??
    NAVIGATION_CONTENT_GAP;
  return (
    <SafeAreaView
      edges={
        scrollable
          ? ['top', 'right', 'left']
          : ['top', 'right', 'bottom', 'left']
      }
      style={styles.fill}
      testID="safe-area-root"
    >
      {scrollable ? (
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[
            styles.scrollContent,
            scrollContentStyle,
            {
              paddingBottom:
                bottom +
                (typeof endGap === 'number' ? endGap : NAVIGATION_CONTENT_GAP),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          style={styles.fill}
          testID={scrollTestID}
        >
          {children}
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
