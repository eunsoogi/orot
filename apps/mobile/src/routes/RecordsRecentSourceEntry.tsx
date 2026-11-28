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
  readonly onOpen: () => void;
}

/** Renders a real local source and routes each record type to its existing destination. */
export function RecordsRecentSourceEntry({
  record,
  groupLabel,
  documentIndex,
  documentsOpening,
  onOpen,
}: RecordsRecentSourceEntryProps) {
  const time = formatRecentTime(record.timestamp);
  const testID =
    record.kind === 'medical_document'
      ? `medical-document-source-${documentIndex}`
      : `records-recent-source-${record.id}`;
  const icon =
    record.kind === 'recording'
      ? 'mic.fill'
      : record.kind === 'saved_memory'
        ? 'bookmark'
        : 'doc.text';
  const label = [groupLabel, record.title, record.summary, time]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={record.kind === 'medical_document' && documentsOpening}
      key={`${record.kind}:${record.id}`}
      onPress={onOpen}
      style={[
        styles.row,
        record.kind === 'medical_document' &&
          documentsOpening &&
          styles.disabled,
      ]}
      testID={testID}
    >
      <View style={styles.icon}>
        <AppSymbol name={icon} color={appColors.primaryText} />
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
    minHeight: 44,
    minWidth: 0,
    paddingVertical: 7,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  title: { color: appColors.text, fontSize: 15, fontWeight: '600' },
  summary: { color: appColors.secondary, fontSize: 14, lineHeight: 19 },
  time: { color: appColors.secondary, fontSize: 14, textAlign: 'right' },
  disabled: { opacity: 0.55 },
});
