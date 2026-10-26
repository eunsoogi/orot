import { useState } from 'react';
import { Button, Keyboard, Platform, Text, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import TextInput from './SymptomTextInput';
import { toSymptomTimestamp } from './dateTime';
import SymptomCreateFields from './SymptomCreateFields';
import styles from './SymptomForm.styles';
import SymptomKeyboardAccessoryGroup from './SymptomKeyboardAccessoryGroup';
import type { NewSymptomDraft, SymptomEdit } from './types';
import {
  formKeyboardFields,
  formInputAccessoryID,
} from './symptomFormKeyboard';

type SymptomFormProps = {
  onCancel: () => void;
  onDraftChange?: () => void;
  onSavingChange?: (saving: boolean) => void;
  onCreate: (draft: NewSymptomDraft) => Promise<void> | void;
  onUpdate: (id: string, changes: SymptomEdit) => Promise<void> | void;
} & ({ mode: 'create'; entry?: never } | { mode: 'edit'; entry: SymptomEntry });

export default function SymptomForm({
  mode,
  entry,
  onCancel,
  onDraftChange,
  onSavingChange,
  onCreate,
  onUpdate,
}: SymptomFormProps) {
  const [description, setDescription] = useState(entry?.description ?? '');
  const [bodySite, setBodySite] = useState(entry?.bodySite ?? '');
  const [severity, setSeverity] = useState(
    entry?.severity === undefined ? '' : String(entry.severity),
  );
  const [onsetDate, setOnsetDate] = useState('');
  const [onsetTime, setOnsetTime] = useState('');
  const [resolvedDate, setResolvedDate] = useState('');
  const [resolvedTime, setResolvedTime] = useState('');
  const [status, setStatus] = useState<SymptomEntry['status'] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      onDraftChange?.();
    };
  }

  async function save() {
    setError('');
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError('Describe the symptom before saving.');
      return;
    }
    let selectedSeverity: number | null = null;
    if (severity.trim()) {
      selectedSeverity = Number(severity);
      if (
        !Number.isInteger(selectedSeverity) ||
        selectedSeverity < 0 ||
        selectedSeverity > 10
      ) {
        setError('Severity must be a whole number from 0 to 10.');
        return;
      }
    }

    setSaving(true);
    onSavingChange?.(true);
    try {
      const trimmedBodySite = bodySite.trim();
      if (mode === 'edit') {
        await onUpdate(entry.id, {
          description: trimmedDescription,
          bodySite: trimmedBodySite || null,
          severity: selectedSeverity,
        });
        onCancel();
        return;
      }
      const onsetAt = toSymptomTimestamp(onsetDate, onsetTime);
      if (!onsetAt) {
        setError('Enter a valid local onset date and time.');
        return;
      }
      if (!status) {
        setError('Choose the symptom status.');
        return;
      }
      const details = {
        onsetAt,
        description: trimmedDescription,
        ...(trimmedBodySite ? { bodySite: trimmedBodySite } : {}),
        ...(selectedSeverity === null ? {} : { severity: selectedSeverity }),
      };
      if (status === 'active') {
        await onCreate({ ...details, status });
      } else {
        const resolvedAt = toSymptomTimestamp(resolvedDate, resolvedTime);
        if (!resolvedAt) {
          setError('Enter a valid local resolution date and time.');
          return;
        }
        await onCreate({ ...details, status, resolvedAt });
      }
      onCancel();
    } catch {
      setError(
        mode === 'edit'
          ? 'The symptom could not be updated. Try again.'
          : 'The symptom could not be saved. Try again.',
      );
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text accessibilityRole="header" style={styles.formTitle}>
        {mode === 'edit' ? 'Edit symptom' : 'New symptom'}
      </Text>
      <TextInput
        accessibilityLabel="Symptom description"
        multiline
        onChangeText={change(setDescription)}
        placeholder="Describe what you feel"
        inputAccessoryViewID={formInputAccessoryID('description', mode)}
        style={[styles.input, styles.description]}
        testID="symptom-description"
        value={description}
      />
      {mode === 'create' ? (
        <SymptomCreateFields
          inputAccessoryViewIDs={{
            onsetDate: formInputAccessoryID('onsetDate'),
            onsetTime: formInputAccessoryID('onsetTime'),
            resolvedDate: formInputAccessoryID('resolvedDate'),
            resolvedTime: formInputAccessoryID('resolvedTime'),
          }}
          onsetDate={onsetDate}
          onsetTime={onsetTime}
          resolvedDate={resolvedDate}
          resolvedTime={resolvedTime}
          setOnsetDate={change(setOnsetDate)}
          setOnsetTime={change(setOnsetTime)}
          setResolvedDate={change(setResolvedDate)}
          setResolvedTime={change(setResolvedTime)}
          setStatus={change(setStatus)}
          status={status}
        />
      ) : null}
      <TextInput
        accessibilityLabel="Optional body site"
        onChangeText={change(setBodySite)}
        inputAccessoryViewID={formInputAccessoryID('bodySite')}
        placeholder="Body area (optional)"
        style={styles.input}
        testID="symptom-body-site"
        value={bodySite}
      />
      <TextInput
        accessibilityLabel="Optional severity from zero to ten"
        keyboardType="number-pad"
        onChangeText={change(setSeverity)}
        inputAccessoryViewID={formInputAccessoryID('severity')}
        placeholder="Severity (optional, 0–10)"
        style={styles.input}
        testID="symptom-severity"
        value={severity}
      />
      <Text style={styles.hint}>Severity is optional and entered by you.</Text>
      {error ? (
        <Text accessibilityRole="alert" testID="symptom-form-error">
          {error}
        </Text>
      ) : null}
      <Button
        disabled={saving || (mode === 'create' && status === null)}
        onPress={() => {
          save();
        }}
        testID="symptom-save"
        title={
          saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Save symptom'
        }
      />
      <Button
        disabled={saving}
        onPress={onCancel}
        testID="symptom-form-cancel"
        title="Close"
      />
      {Platform.OS === 'ios' ? (
        <SymptomKeyboardAccessoryGroup
          actions={[
            {
              label: mode === 'edit' ? 'Save changes' : 'Save symptom',
              testID: 'symptom-keyboard-save',
              disabled: saving || (mode === 'create' && status === null),
              onPress: () => {
                Keyboard.dismiss();
                save();
              },
            },
            {
              label: 'Close',
              testID: 'symptom-keyboard-close',
              disabled: saving,
              onPress: () => {
                Keyboard.dismiss();
                onCancel();
              },
            },
          ]}
          fields={formKeyboardFields(mode)}
        />
      ) : null}
    </View>
  );
}
