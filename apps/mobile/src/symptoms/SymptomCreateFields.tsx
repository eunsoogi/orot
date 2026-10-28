import { Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import TextInput from './SymptomTextInput';
import type { SymptomEntry } from '@orot/storage';
import styles from './SymptomForm.styles';
import { symptomStatusLabel } from './presentation';

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
      <Text style={styles.fieldLabel}>
        {t('symptoms.journal.form.onset.title')}
      </Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel={t('symptoms.journal.form.onset.date')}
          inputAccessoryViewID={inputAccessoryViewIDs.onsetDate}
          onChangeText={setOnsetDate}
          placeholder="YYYY-MM-DD"
          style={[styles.input, styles.halfInput]}
          testID="symptom-onset-date"
          value={onsetDate}
        />
        <TextInput
          accessibilityLabel={t('symptoms.journal.form.onset.time')}
          inputAccessoryViewID={inputAccessoryViewIDs.onsetTime}
          onChangeText={setOnsetTime}
          placeholder="HH:MM"
          style={[styles.input, styles.halfInput]}
          testID="symptom-onset-time"
          value={onsetTime}
        />
      </View>
      <Text style={styles.fieldLabel}>
        {t('symptoms.journal.form.status.title')}
      </Text>
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
          <Text>{symptomStatusLabel('active')}</Text>
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
          <Text>{symptomStatusLabel('resolved')}</Text>
        </Pressable>
      </View>
      {status === 'resolved' ? (
        <>
          <Text style={styles.fieldLabel}>
            {t('symptoms.journal.form.resolved.title')}
          </Text>
          <View style={styles.row}>
            <TextInput
              accessibilityLabel={t('symptoms.journal.form.resolved.date')}
              inputAccessoryViewID={inputAccessoryViewIDs.resolvedDate}
              onChangeText={setResolvedDate}
              placeholder="YYYY-MM-DD"
              style={[styles.input, styles.halfInput]}
              testID="symptom-resolved-date"
              value={resolvedDate}
            />
            <TextInput
              accessibilityLabel={t('symptoms.journal.form.resolved.time')}
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
