import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/** Supplies a bounded viewport to the standalone production ScrollView; diagnostics remain ordinary siblings. */
export function ImportProbeShell({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <SafeAreaProvider style={styles.root}>
      <SafeAreaView style={styles.root}>{children}</SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
