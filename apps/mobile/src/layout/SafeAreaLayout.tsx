import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

interface SafeAreaLayoutProps {
  children: ReactNode;
  scrollable?: boolean;
}

// Non-provider routes share one inset owner; screens with their own scroller keep it.
export default function SafeAreaLayout({
  children,
  scrollable = false,
}: SafeAreaLayoutProps) {
  return (
    <SafeAreaProvider style={styles.fill}>
      <SafeAreaView
        edges={['top', 'right', 'bottom', 'left']}
        style={styles.fill}
        testID="safe-area-root"
      >
        {scrollable ? (
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            style={styles.fill}
            testID="safe-area-scroll"
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
});
