import { StyleSheet, Text, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import { appColors } from '../layout/appColors';
import { toLocalSymptomDateTime } from './dateTime';

/** Presents only the selected journal entry's existing user-entered details. */
export default function SymptomSelectionSummary({
  entry,
}: {
  readonly entry: SymptomEntry | null;
}) {
  const onset = entry ? toLocalSymptomDateTime(entry.effectiveAt) : null;
  const resolved = entry?.resolvedAt
    ? toLocalSymptomDateTime(entry.resolvedAt)
    : null;

  return (
    <View style={styles.panel} testID="symptoms-selected-summary">
      <Text accessibilityRole="header" style={styles.title}>
        Selected symptom
      </Text>
      {entry && onset ? (
        <>
          <Text
            style={styles.description}
            testID="symptoms-selected-description"
          >
            {entry.description}
          </Text>
          <Text style={styles.detail} testID="symptoms-selected-onset">
            {onset.date} at {onset.time} (local time)
          </Text>
          <Text style={styles.detail} testID="symptoms-selected-status">
            {entry.status === 'active' ? 'Active' : 'Resolved'}
          </Text>
          <Text style={styles.detail}>
            User-entered · not clinician-confirmed
          </Text>
          {entry.bodySite ? (
            <Text style={styles.detail}>{entry.bodySite}</Text>
          ) : null}
          {entry.severity !== undefined ? (
            <Text style={styles.detail} testID="symptoms-selected-severity">
              Your severity: {entry.severity}/10
            </Text>
          ) : null}
          {resolved ? (
            <Text style={styles.detail}>
              Resolved {resolved.date} at {resolved.time}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.empty} testID="symptoms-selection-empty">
          Select a symptom from the list to see its summary.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    minWidth: 0,
    padding: 18,
  },
  title: { color: appColors.text, fontSize: 18, fontWeight: '700' },
  description: { color: appColors.text, fontSize: 20, fontWeight: '600' },
  detail: { color: appColors.text },
  empty: { color: appColors.secondary, fontSize: 15 },
});
