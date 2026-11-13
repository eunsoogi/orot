import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Keep test controls outside layout flow so the native host retains its production window origin.
 * Only this top panel receives touches; the conversation and keyboard remain unobstructed below it.
 */
export function LeaseProbeOverlay({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView
      testID="retention-probe-overlay"
      edges={['top']}
      pointerEvents="box-none"
      style={styles.overlay}
    >
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
});
