import { Button, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import { appColors } from '../layout/appColors';
import { toLocalSymptomDateTime } from './dateTime';

type SymptomEntryCardProps = {
  entry: SymptomEntry;
  onEdit: () => void;
  onResolve: () => void;
  onSelect: () => void;
  selected?: boolean;
  disabled?: boolean;
};

export default function SymptomEntryCard({
  entry,
  onEdit,
  onResolve,
  onSelect,
  selected = false,
  disabled,
}: SymptomEntryCardProps) {
  const onset = toLocalSymptomDateTime(entry.effectiveAt);
  const resolved = entry.resolvedAt
    ? toLocalSymptomDateTime(entry.resolvedAt)
    : null;

  return (
    <View
      style={[styles.card, selected ? styles.selectedCard : undefined]}
      testID={`symptom-${entry.id}`}
    >
      {/* Keep the selector separate so details and Edit or Resolve stay accessible. */}
      <Pressable
        accessibilityHint="Shows this symptom in the selected summary."
        accessibilityLabel={`${selected ? 'Selected' : 'Select'} symptom: ${entry.description}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        disabled={disabled}
        onPress={onSelect}
        style={styles.selectableDescription}
        testID={`symptom-select-${entry.id}`}
      >
        <Text
          style={styles.description}
          testID={`symptom-${entry.id}-description`}
        >
          {entry.description}
        </Text>
      </Pressable>
      <Text style={styles.detail} testID={`symptom-${entry.id}-onset`}>
        {onset.date} at {onset.time} (local time)
      </Text>
      <Text style={styles.detail} testID={`symptom-${entry.id}-status`}>
        {entry.status === 'active' ? 'Active' : 'Resolved'}
      </Text>
      <Text style={styles.detail}>User-entered · not clinician-confirmed</Text>
      {entry.bodySite ? (
        <Text style={styles.detail}>{entry.bodySite}</Text>
      ) : null}
      {entry.severity !== undefined ? (
        <Text style={styles.detail} testID={`symptom-${entry.id}-severity`}>
          Your severity: {entry.severity}/10
        </Text>
      ) : null}
      {resolved ? (
        <Text style={styles.detail}>
          Resolved {resolved.date} at {resolved.time}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          disabled={disabled}
          onPress={onEdit}
          testID={`symptom-edit-${entry.id}`}
          title="Edit symptom"
        />
        {entry.status === 'active' ? (
          <Button
            disabled={disabled}
            onPress={onResolve}
            testID={`symptom-resolve-${entry.id}`}
            title="Mark resolved"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  selectedCard: {
    backgroundColor: appColors.primarySoft,
    borderColor: appColors.primaryText,
  },
  selectableDescription: { borderRadius: 8, minHeight: 44 },
  description: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  detail: { color: appColors.text },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 16,
  },
});
