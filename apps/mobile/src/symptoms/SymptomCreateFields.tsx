import { Pressable, Text, TextInput, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import styles from './SymptomForm.styles';

interface SymptomCreateFieldsProps {
  inputAccessoryViewIDs: {
    onsetDate?: string;
    onsetTime?: string;
    resolvedDate?: string;
    resolvedTime?: string;
  };
  onsetDate: string;
  onsetTime: string;
  resolvedDate: string;
  resolvedTime: string;
  status: SymptomEntry['status'] | null;
  setOnsetDate: (value: string) => void;
  setOnsetTime: (value: string) => void;
  setResolvedDate: (value: string) => void;
  setResolvedTime: (value: string) => void;
  setStatus: (value: SymptomEntry['status']) => void;
}

export default function SymptomCreateFields({
  inputAccessoryViewIDs,
  onsetDate,
  onsetTime,
  resolvedDate,
  resolvedTime,
  status,
  setOnsetDate,
  setOnsetTime,
  setResolvedDate,
  setResolvedTime,
  setStatus,
}: SymptomCreateFieldsProps) {
  return (
    <>
      <Text style={styles.fieldLabel}>When it started (your local time)</Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Symptom onset date"
          inputAccessoryViewID={inputAccessoryViewIDs.onsetDate}
          onChangeText={setOnsetDate}
          placeholder="YYYY-MM-DD"
          style={[styles.input, styles.halfInput]}
          testID="symptom-onset-date"
          value={onsetDate}
        />
        <TextInput
          accessibilityLabel="Symptom onset time"
          inputAccessoryViewID={inputAccessoryViewIDs.onsetTime}
          onChangeText={setOnsetTime}
          placeholder="HH:MM"
          style={[styles.input, styles.halfInput]}
          testID="symptom-onset-time"
          value={onsetTime}
        />
      </View>
      <Text style={styles.fieldLabel}>Status</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: status === 'active' }}
          onPress={() => setStatus('active')}
          style={[
            styles.choice,
            status === 'active' ? styles.selectedChoice : null,
          ]}
          testID="symptom-status-active"
        >
          <Text>Active</Text>
        </Pressable>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: status === 'resolved' }}
          onPress={() => setStatus('resolved')}
          style={[
            styles.choice,
            status === 'resolved' ? styles.selectedChoice : null,
          ]}
          testID="symptom-status-resolved"
        >
          <Text>Resolved</Text>
        </Pressable>
      </View>
      {status === 'resolved' ? (
        <>
          <Text style={styles.fieldLabel}>
            When it resolved (your local time)
          </Text>
          <View style={styles.row}>
            <TextInput
              accessibilityLabel="Symptom resolution date"
              inputAccessoryViewID={inputAccessoryViewIDs.resolvedDate}
              onChangeText={setResolvedDate}
              placeholder="YYYY-MM-DD"
              style={[styles.input, styles.halfInput]}
              testID="symptom-resolved-date"
              value={resolvedDate}
            />
            <TextInput
              accessibilityLabel="Symptom resolution time"
              inputAccessoryViewID={inputAccessoryViewIDs.resolvedTime}
              onChangeText={setResolvedTime}
              placeholder="HH:MM"
              style={[styles.input, styles.halfInput]}
              testID="symptom-resolved-time"
              value={resolvedTime}
            />
          </View>
        </>
      ) : null}
    </>
  );
}
