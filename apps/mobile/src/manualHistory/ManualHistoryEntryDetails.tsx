import { Button, StyleSheet, Text, View } from 'react-native';
import type { ManualHistoryScreenRecord } from './types';

interface ManualHistoryEntryDetailsProps {
  entry: ManualHistoryScreenRecord;
  history: ManualHistoryScreenRecord[];
  onCorrect: () => void;
  onClose: () => void;
}

const KIND_LABELS: Record<ManualHistoryScreenRecord['kind'], string> = {
  diagnosis_history: 'Diagnosis or history',
  procedure: 'Procedure',
  medication_context: 'Medication context',
  note: 'Free-form note',
};

function effectiveDateLabel(value: ManualHistoryScreenRecord['effectiveDate']): string {
  return value.status === 'known' ? 'Effective date: ' + value.date : 'Effective date unknown';
}

function reviewLabel(entry: ManualHistoryScreenRecord): string {
  return entry.reviewState.status === 'unreviewed'
    ? 'Unreviewed'
    : entry.reviewState.status === 'needs_review'
      ? 'Needs review'
      : 'Reviewed';
}

function recordedAtLabel(recordedAt: string): string {
  return 'Recorded: ' + new Date(recordedAt).toLocaleString();
}

export default function ManualHistoryEntryDetails({
  entry,
  history,
  onCorrect,
  onClose,
}: ManualHistoryEntryDetailsProps) {
  return (
    <View style={styles.container} testID="manual-history-detail">
      <Text accessibilityRole="header" style={styles.sectionTitle}>Entry details</Text>
      <Text style={styles.entryTitle}>{entry.title}</Text>
      <Text>{KIND_LABELS[entry.kind]}</Text>
      <Text testID="manual-history-date-detail">{effectiveDateLabel(entry.effectiveDate)}</Text>
      <Text>{entry.details}</Text>
      {history.length <= 1 ? <Text>User entered · {reviewLabel(entry)}</Text> : null}
      {history.length > 1 ? (
        <View style={styles.history} testID="manual-history-correction-history">
          <Text style={styles.sectionTitle}>Correction history</Text>
          {history.map((version, index) => (
            <View
              key={version.id}
              style={styles.version}
              testID={'manual-history-version-' + version.id}
            >
              <Text>{index === history.length - 1 ? 'Current version' : 'Earlier version'}</Text>
              <Text>{KIND_LABELS[version.kind]}</Text>
              <Text>User entered · {reviewLabel(version)}</Text>
              <Text testID="manual-history-recorded-at">{recordedAtLabel(version.recordedAt)}</Text>
              <Text style={styles.entryTitle}>{version.title}</Text>
              <Text testID={'manual-history-date-version-' + version.id}>
                {effectiveDateLabel(version.effectiveDate)}
              </Text>
              <Text>{version.details}</Text>
              {version.correctionNote ? <Text>Correction note: {version.correctionNote}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      <Button onPress={onCorrect} testID="manual-history-correct" title="Correct this entry" />
      <Button onPress={onClose} testID="manual-history-close-details" title="Close details" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: 'white', borderRadius: 10, gap: 8, padding: 14 },
  sectionTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  entryTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  history: { gap: 8, paddingTop: 8 },
  version: { borderLeftColor: '#a8b3bf', borderLeftWidth: 2, gap: 6, paddingLeft: 10 },
});
