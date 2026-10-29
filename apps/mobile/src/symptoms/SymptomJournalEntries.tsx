import type { ReactNode } from 'react';
import type { SymptomEntry } from '@orot/storage';
import { Text, View } from 'react-native';
import { t } from '../i18n';
import { toLocalSymptomDateTime } from './dateTime';
import styles from './SymptomsScreen.styles';

/** Groups the existing result order by local onset day without altering inclusive filter instants. */
export default function SymptomJournalEntries({
  entries,
  renderEntry,
}: {
  readonly entries: readonly SymptomEntry[];
  readonly renderEntry: (entry: SymptomEntry) => ReactNode;
}) {
  const groups = new Map<string, SymptomEntry[]>();
  for (const entry of entries) {
    const day = toLocalSymptomDateTime(entry.effectiveAt).date;
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  }
  const now = new Date();
  const today = toLocalSymptomDateTime(now.toISOString()).date;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const priorDay = toLocalSymptomDateTime(yesterday.toISOString()).date;
  return (
    <>
      {Array.from(groups, ([day, values]) => (
        <View key={day} style={styles.primaryPanel}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            {day === today
              ? t('symptoms.journal.today')
              : day === priorDay
                ? t('symptoms.journal.yesterday')
                : day}
          </Text>
          {values.map(renderEntry)}
        </View>
      ))}
    </>
  );
}
