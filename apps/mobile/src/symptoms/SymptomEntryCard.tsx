import { Button, StyleSheet, Text, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import { toLocalSymptomDateTime } from './dateTime';

type SymptomEntryCardProps = {
  entry: SymptomEntry;
  onEdit: () => void;
  onResolve: () => void;
};

export default function SymptomEntryCard({ entry, onEdit, onResolve }: SymptomEntryCardProps) {
  const onset = toLocalSymptomDateTime(entry.effectiveAt);
  const resolved = entry.resolvedAt ? toLocalSymptomDateTime(entry.resolvedAt) : null;

  return (
    <View style={styles.card} testID={`symptom-${entry.id}`}>
      <Text style={styles.description} testID={`symptom-${entry.id}-description`}>
        {entry.description}
      </Text>
      <Text testID={`symptom-${entry.id}-onset`}>{onset.date} at {onset.time} (local time)</Text>
      <Text testID={`symptom-${entry.id}-status`}>
        {entry.status === 'active' ? 'Active' : 'Resolved'}
      </Text>
      <Text>User-entered · not clinician-confirmed</Text>
      {entry.bodySite ? <Text>{entry.bodySite}</Text> : null}
      {entry.severity !== undefined ? (
        <Text testID={`symptom-${entry.id}-severity`}>Your severity: {entry.severity}/10</Text>
      ) : null}
      {resolved ? <Text>Resolved {resolved.date} at {resolved.time}</Text> : null}
      <View style={styles.actions}>
        <Button onPress={onEdit} testID={`symptom-edit-${entry.id}`} title="Edit symptom" />
        {entry.status === 'active' ? (
          <Button onPress={onResolve} testID={`symptom-resolve-${entry.id}`} title="Mark resolved" />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: 'white', borderRadius: 10, gap: 8, padding: 14 },
  description: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 16 },
});
