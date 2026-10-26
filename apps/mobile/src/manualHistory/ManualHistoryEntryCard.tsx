import { Button, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import type { ManualHistoryScreenRecord } from './types';

function kindLabel(kind: ManualHistoryScreenRecord['kind']): string {
  return t(
    ('manualHistory.kind.' +
      kind) as `manualHistory.kind.${ManualHistoryScreenRecord['kind']}`,
  );
}

function entryStatus(entry: ManualHistoryScreenRecord): string {
  const reviewKey = ('manualHistory.review.' + entry.reviewState.status) as
    | 'manualHistory.review.unreviewed'
    | 'manualHistory.review.needs_review'
    | 'manualHistory.review.reviewed';
  return t('manualHistory.status', { review: t(reviewKey) });
}

function dateLabel(entry: ManualHistoryScreenRecord): string {
  return entry.effectiveDate.status === 'known'
    ? t('manualHistory.date.known', { date: entry.effectiveDate.date })
    : t('manualHistory.date.unknown');
}

/** Shows date and provenance beside each item so unknown dates remain explicit in the list. */
export function ManualHistoryEntryCard({
  entry,
  onOpenDetails,
}: {
  readonly entry: ManualHistoryScreenRecord;
  readonly onOpenDetails: () => void;
}) {
  return (
    <View style={styles.card} testID={'manual-history-entry-' + entry.id}>
      <Text style={styles.entryTitle}>{entry.title}</Text>
      <Text>{kindLabel(entry.kind)}</Text>
      <Text testID={'manual-history-date-' + entry.id}>{dateLabel(entry)}</Text>
      <Text>{entryStatus(entry)}</Text>
      <Button
        onPress={onOpenDetails}
        testID={'manual-history-details-' + entry.id}
        title={t('manualHistory.details')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: 'white', borderRadius: 10, gap: 8, padding: 14 },
  entryTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
});
