import { useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

/** Measures the card rather than the window: a Duo content lane can be much narrower. */
export function HealthRecordsCategoryHeading({
  icon,
  children,
  action,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly action: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  // Until measured, and at large text sizes, give the action its own bounded line.
  const stacked = width < 440 || fontScale > 1.3;
  return (
    <View
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[styles.heading, !stacked && styles.inline]}
      testID="health-record-category-heading"
    >
      <View style={[styles.identity, !stacked && styles.grow]}>
        {icon}
        <View style={styles.copy}>{children}</View>
      </View>
      <View style={stacked ? styles.stackedAction : styles.inlineAction}>
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 12, minWidth: 0 },
  inline: { flexDirection: 'row', alignItems: 'center' },
  identity: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  grow: { flex: 1 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  stackedAction: { alignSelf: 'stretch', minWidth: 0 },
  inlineAction: { maxWidth: '45%', minWidth: 0 },
});
