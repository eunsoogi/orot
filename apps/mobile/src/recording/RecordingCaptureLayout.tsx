import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

/** Short landscape frames use two stable lanes rather than putting Stop below a scroll boundary. */
export function RecordingCaptureLayout({
  primary,
  secondary,
  testID,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  testID: string;
}) {
  const { width, height } = useWindowDimensions();
  const wide = width > height && width >= 600;
  return (
    <View
      style={[styles.frame, wide ? styles.wide : styles.narrow]}
      testID={testID}
    >
      <View style={styles.panel}>{primary}</View>
      <View style={styles.panel}>{secondary}</View>
    </View>
  );
}
const styles = StyleSheet.create({
  wide: { flexDirection: 'row' },
  narrow: { flexDirection: 'column' },
  frame: {
    flex: 1,
    minHeight: 0,
    gap: 12,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  panel: {
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 0,
    justifyContent: 'center',
  },
});
