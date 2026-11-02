import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import type { RecentRecordEntry } from './RecordsRecentTimeline';
import { formatRecentTime } from './RecordsRecentTimeline';

interface RecordsRecentSourceEntryProps {
  readonly record: RecentRecordEntry;
  readonly groupLabel: string;
  readonly documentIndex?: number;
  readonly documentsOpening: boolean;
  readonly onOpenMedicalDocument: (sourceId: string) => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenSymptoms: () => void;
}

/** Renders a real local source and routes each record type to its existing destination. */
export function RecordsRecentSourceEntry({
  record,
  groupLabel,
  documentIndex,
  documentsOpening,
  onOpenMedicalDocument,
  onOpenSavedRecordings,
  onOpenSymptoms,
}: RecordsRecentSourceEntryProps) {
  const time = formatRecentTime(record.timestamp);
  const testID =
    record.kind === 'recording'
      ? `records-recent-source-${record.id}`
      : record.kind === 'medical_document'
        ? `medical-document-source-${documentIndex}`
        : `records-recent-symptom-${record.id}`;
  const icon =
    record.kind === 'recording'
      ? 'mic.fill'
      : record.kind === 'medical_document'
        ? 'doc.text'
        : 'square.and.pencil';
  const label = [groupLabel, record.title, record.summary, time]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={record.kind === 'medical_document' && documentsOpening}
      key={`${record.kind}:${record.id}`}
      onPress={() => {
        if (record.kind === 'recording') onOpenSavedRecordings();
        else if (record.kind === 'medical_document')
          onOpenMedicalDocument(record.id);
        else onOpenSymptoms();
      }}
      style={[
        styles.row,
        record.kind === 'medical_document' &&
          documentsOpening &&
          styles.disabled,
      ]}
      testID={testID}
    >
      <View style={styles.markerColumn}>
        <View style={styles.marker} />
      </View>
      <View style={styles.icon}>
        <AppSymbol name={icon} color={appColors.primaryAction} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{record.title}</Text>
        {record.summary ? (
          <Text style={styles.summary}>{record.summary}</Text>
        ) : null}
      </View>
      <Text style={styles.time}>{time}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    minWidth: 0,
    paddingVertical: 7,
  },
  markerColumn: { alignItems: 'center', width: 12 },
  marker: {
    backgroundColor: appColors.primaryAction,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  title: { color: appColors.text, fontSize: 15, fontWeight: '600' },
  summary: { color: appColors.secondary, fontSize: 14, lineHeight: 19 },
  time: { color: appColors.secondary, fontSize: 14, textAlign: 'right' },
  disabled: { opacity: 0.55 },
});
