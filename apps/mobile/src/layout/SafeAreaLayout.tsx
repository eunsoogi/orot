import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BOTTOM_NAVIGATION_CONTENT_INSET } from '../navigation/navigationLayout';
import { appColors } from './appColors';

interface SafeAreaLayoutProps {
  children: ReactNode;
  scrollable?: boolean;
}

// Standalone routes share one safe-area owner, appearance-matched backdrop, and optional scroller.
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
  fill: { backgroundColor: appColors.background, flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: BOTTOM_NAVIGATION_CONTENT_INSET,
  },
});
