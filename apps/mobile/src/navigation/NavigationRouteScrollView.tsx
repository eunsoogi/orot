import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BOTTOM_NAVIGATION_CONTENT_INSET } from './navigationLayout';

/** Lets route content fill its viewport and scroll behind the shared glass actions. */
export function NavigationRouteScrollView({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { bottom } = useSafeAreaInsets();
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[
        styles.content,
        { paddingBottom: BOTTOM_NAVIGATION_CONTENT_INSET + bottom },
      ]}
      keyboardShouldPersistTaps="handled"
      style={styles.fill}
      testID="navigation-route-scroll"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  fill: { flex: 1 },
});
