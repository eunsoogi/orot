import { Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import SymptomDateTimeFields from './SymptomDateTimeFields';
import type { SymptomEntry } from '@orot/storage';
import styles from './SymptomForm.styles';
import { symptomStatusLabel } from './presentation';

interface SymptomCreateFieldsProps {
  onPickerOpenChange: (kind: 'onset' | 'resolved', open: boolean) => void;
  inputAccessoryViewIDs: {
    onsetDate?: string;
    onsetTime?: string;
    resolvedDate?: string;
    resolvedTime?: string;
  };
  onsetInstant: string | null;
  resolvedInstant: string | null;
  onSelectOnset: (value: string | null) => void;
  onSelectResolved: (value: string | null) => void;
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
  onPickerOpenChange,
  onsetInstant,
  resolvedInstant,
  onSelectOnset,
  onSelectResolved,
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
      <SymptomDateTimeFields
        kind="onset"
        onPickerOpenChange={open => onPickerOpenChange('onset', open)}
        initialInstant={onsetInstant}
        date={onsetDate}
        time={onsetTime}
        setDate={setOnsetDate}
        setTime={setOnsetTime}
        onSelectInstant={onSelectOnset}
        accessoryIDs={{
          date: inputAccessoryViewIDs.onsetDate,
          time: inputAccessoryViewIDs.onsetTime,
        }}
      />
      <View style={styles.section}>
        <Text style={styles.fieldLabel}>
          {t('symptoms.journal.form.status.title')}
        </Text>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: status === 'active' }}
            onPress={() => {
              onPickerOpenChange('resolved', false);
              setStatus('active');
            }}
            style={[
              styles.choice,
              status === 'active' ? styles.selectedChoice : null,
            ]}
            testID="symptom-status-active"
          >
            <Text style={styles.choiceLabel}>
              {symptomStatusLabel('active')}
            </Text>
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
            <Text style={styles.choiceLabel}>
              {symptomStatusLabel('resolved')}
            </Text>
          </Pressable>
        </View>
      </View>
      {status === 'resolved' ? (
        <SymptomDateTimeFields
          kind="resolved"
          onPickerOpenChange={open => onPickerOpenChange('resolved', open)}
          initialInstant={resolvedInstant}
          date={resolvedDate}
          time={resolvedTime}
          setDate={setResolvedDate}
          setTime={setResolvedTime}
          onSelectInstant={onSelectResolved}
          accessoryIDs={{
            date: inputAccessoryViewIDs.resolvedDate,
            time: inputAccessoryViewIDs.resolvedTime,
          }}
        />
      ) : null}
    </>
  );
}
