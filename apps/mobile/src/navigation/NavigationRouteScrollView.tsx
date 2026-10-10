import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigationContentInset } from './useNavigationContentInset';

/** Lets route content fill its viewport and scroll behind the shared glass actions. */
export function NavigationRouteScrollView({
  children,
}: {
  readonly children: ReactNode;
}) {
  const navigationInset = useNavigationContentInset();
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.content, navigationInset]}
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
