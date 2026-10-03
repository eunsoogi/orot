import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ManualHistoryScreenDraft, ManualHistoryScreenRecord } from './types';

interface ManualHistoryFormProps {
  initialValue?: ManualHistoryScreenDraft;
  isCorrection: boolean;
  saving: boolean;
  onSave: (draft: ManualHistoryScreenDraft) => Promise<void>;
  onClose: () => void;
}

const KIND_LABELS: Record<ManualHistoryScreenRecord['kind'], string> = {
  diagnosis_history: 'Diagnosis or history',
  procedure: 'Procedure',
  medication_context: 'Medication context',
  note: 'Free-form note',
};

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export default function ManualHistoryForm({
  initialValue,
  isCorrection,
  saving,
  onSave,
  onClose,
}: ManualHistoryFormProps) {
  const [kind, setKind] = useState<ManualHistoryScreenRecord['kind']>(
    initialValue?.kind ?? 'diagnosis_history',
  );
  const [title, setTitle] = useState(initialValue?.title ?? '');
  const [details, setDetails] = useState(initialValue?.details ?? '');
  const [effectiveDate, setEffectiveDate] = useState(
    initialValue?.effectiveDate.status === 'known' ? initialValue.effectiveDate.date : '',
  );
  const [dateUnknown, setDateUnknown] = useState(initialValue?.effectiveDate.status === 'unknown');
  const [correctionNote, setCorrectionNote] = useState('');
  const [validationError, setValidationError] = useState('');

  async function save() {
    if (!title.trim() || !details.trim()) {
      setValidationError('Enter a title and details.');
      return;
    }
    if (!dateUnknown && !isIsoDate(effectiveDate)) {
      setValidationError('Enter a valid effective date or mark the date unknown.');
      return;
    }

    setValidationError('');
    await onSave({
      kind,
      title: title.trim(),
      details: details.trim(),
      effectiveDate: dateUnknown
        ? { status: 'unknown' }
        : { status: 'known', date: effectiveDate },
      ...(isCorrection && correctionNote.trim()
        ? { correctionNote: correctionNote.trim() }
        : {}),
    });
  }

  return (
    <View style={styles.form}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {isCorrection ? 'Correct medical history' : 'New medical history'}
      </Text>
      <Text style={styles.fieldLabel}>Entry type</Text>
      {(Object.keys(KIND_LABELS) as ManualHistoryScreenRecord['kind'][]).map(value => (
        <Button
          key={value}
          onPress={() => setKind(value)}
          testID={'manual-history-kind-' + value}
          title={(kind === value ? 'Selected: ' : '') + KIND_LABELS[value]}
        />
      ))}
      <TextInput
        accessibilityLabel="Title"
        onChangeText={setTitle}
        placeholder="Title"
        style={styles.input}
        testID="manual-history-title-input"
        value={title}
      />
      <TextInput
        accessibilityLabel="Details"
        multiline
        onChangeText={setDetails}
        placeholder="Details"
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        style={[styles.input, styles.detailsInput]}
        testID="manual-history-details-input"
        value={details}
      />
      <Text style={styles.fieldLabel}>Effective date</Text>
      {!dateUnknown ? (
        <TextInput
          accessibilityLabel="Effective date"
          onChangeText={value => {
            setEffectiveDate(value);
            setDateUnknown(false);
          }}
          placeholder="YYYY-MM-DD"
          style={styles.input}
          testID="manual-history-effective-date-input"
          value={effectiveDate}
        />
      ) : (
        <Text testID="manual-history-date-unknown-selected">Date is unknown</Text>
      )}
      <Button
        onPress={() => {
          setDateUnknown(!dateUnknown);
          if (!dateUnknown) setEffectiveDate('');
        }}
        testID="manual-history-date-unknown"
        title={dateUnknown ? 'Enter a known date' : 'Date is unknown'}
      />
      {isCorrection ? (
        <TextInput
          accessibilityLabel="Optional correction note"
          onChangeText={setCorrectionNote}
          placeholder="Optional correction note"
          style={styles.input}
          testID="manual-history-correction-note-input"
          value={correctionNote}
        />
      ) : null}
      {validationError ? (
        <Text accessibilityRole="alert" testID="manual-history-validation-error">
          {validationError}
        </Text>
      ) : null}
      <Button
        disabled={saving}
        onPress={save}
        testID="manual-history-save"
        title={saving ? 'Saving…' : isCorrection ? 'Save correction' : 'Save medical history'}
      />
      <Button disabled={saving} onPress={onClose} testID="manual-history-form-close" title="Close" />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { backgroundColor: 'white', borderRadius: 10, gap: 10, padding: 14 },
  sectionTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  fieldLabel: { color: '#17212b', fontWeight: '600' },
  input: { borderColor: '#a8b3bf', borderRadius: 8, borderWidth: 1, padding: 10 },
  detailsInput: { minHeight: 72, textAlignVertical: 'top' },
});
