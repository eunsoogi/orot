import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { HealthSummaryText } from './HealthSummaryText';

/** Shared report rhythm has no inner scrolling, truncation or independent source state. */
export function ConversationReportSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <HealthSummaryText text={title} title />
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 6 },
});
