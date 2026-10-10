import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { BOTTOM_NAVIGATION_CONTENT_INSET } from './navigationLayout';

/** Lets route content fill its viewport and scroll behind the shared glass actions. */
export function NavigationRouteScrollView({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.fill}
      testID="navigation-route-scroll"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: BOTTOM_NAVIGATION_CONTENT_INSET },
  fill: { flex: 1 },
});
