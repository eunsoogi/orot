import { useEffect, useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import type {
  ManualHistoryScreenDraft,
  ManualHistoryScreenRecord,
} from './types';
import { MANUAL_HISTORY_KINDS } from './types';
import type { ManualHistoryScreenFormDraft } from './types';

interface ManualHistoryFormProps {
  initialValue?: ManualHistoryScreenFormDraft;
  isCorrection: boolean;
  saving: boolean;
  onSave: (draft: ManualHistoryScreenDraft) => Promise<void>;
  onDraftChange: (draft: ManualHistoryScreenFormDraft) => void;
  onClose: () => void;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export default function ManualHistoryForm({
  initialValue,
  isCorrection,
  saving,
  onSave,
  onDraftChange,
  onClose,
}: ManualHistoryFormProps) {
  const [kind, setKind] = useState<ManualHistoryScreenRecord['kind']>(
    initialValue?.kind ?? 'diagnosis_history',
  );
  const [title, setTitle] = useState(initialValue?.title ?? '');
  const [details, setDetails] = useState(initialValue?.details ?? '');
  const [effectiveDate, setEffectiveDate] = useState(
    initialValue?.effectiveDateText ?? '',
  );
  const [dateUnknown, setDateUnknown] = useState(
    initialValue?.dateUnknown ?? false,
  );
  const [correctionNote, setCorrectionNote] = useState(
    initialValue?.correctionNote ?? '',
  );
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    onDraftChange({
      kind,
      title,
      details,
      effectiveDateText: effectiveDate,
      dateUnknown,
      correctionNote,
    });
  }, [
    correctionNote,
    dateUnknown,
    details,
    effectiveDate,
    kind,
    onDraftChange,
    title,
  ]);

  async function save() {
    if (!title.trim() || !details.trim()) {
      setValidationError(t('manualHistory.form.validation.required'));
      return;
    }
    if (!dateUnknown && !isIsoDate(effectiveDate)) {
      setValidationError(t('manualHistory.form.validation.date'));
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
        {isCorrection
          ? t('manualHistory.form.correctTitle')
          : t('manualHistory.form.newTitle')}
      </Text>
      <Text style={styles.fieldLabel}>{t('manualHistory.form.kind')}</Text>
      {MANUAL_HISTORY_KINDS.map(value => (
        <Button
          key={value}
          onPress={() => setKind(value)}
          testID={'manual-history-kind-' + value}
          title={
            (kind === value ? '✓ ' : '') +
            t(
              ('manualHistory.kind.' +
                value) as `manualHistory.kind.${ManualHistoryScreenRecord['kind']}`,
            )
          }
        />
      ))}
      <TextInput
        accessibilityLabel={t('manualHistory.form.titleLabel')}
        onChangeText={setTitle}
        placeholder={t('manualHistory.form.titlePlaceholder')}
        style={styles.input}
        testID="manual-history-title-input"
        value={title}
      />
      <TextInput
        accessibilityLabel={t('manualHistory.form.detailsLabel')}
        multiline
        onChangeText={setDetails}
        placeholder={t('manualHistory.form.detailsPlaceholder')}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        style={[styles.input, styles.detailsInput]}
        testID="manual-history-details-input"
        value={details}
      />
      <Text style={styles.fieldLabel}>{t('manualHistory.form.dateLabel')}</Text>
      {!dateUnknown ? (
        <TextInput
          accessibilityLabel={t('manualHistory.form.dateLabel')}
          onChangeText={value => {
            setEffectiveDate(value);
            setDateUnknown(false);
          }}
          placeholder={t('manualHistory.form.datePlaceholder')}
          style={styles.input}
          testID="manual-history-effective-date-input"
          value={effectiveDate}
        />
      ) : (
        <Text testID="manual-history-date-unknown-selected">
          {t('manualHistory.form.dateUnknownSelected')}
        </Text>
      )}
      <Button
        onPress={() => {
          setDateUnknown(!dateUnknown);
          if (!dateUnknown) setEffectiveDate('');
        }}
        testID="manual-history-date-unknown"
        title={
          dateUnknown
            ? t('manualHistory.form.enterKnownDate')
            : t('manualHistory.form.markDateUnknown')
        }
      />
      {isCorrection ? (
        <TextInput
          accessibilityLabel={t('manualHistory.form.correctionNoteLabel')}
          onChangeText={setCorrectionNote}
          placeholder={t('manualHistory.form.correctionNotePlaceholder')}
          style={styles.input}
          testID="manual-history-correction-note-input"
          value={correctionNote}
        />
      ) : null}
      {validationError ? (
        <Text
          accessibilityRole="alert"
          testID="manual-history-validation-error"
        >
          {validationError}
        </Text>
      ) : null}
      <Button
        disabled={saving}
        onPress={save}
        testID="manual-history-save"
        title={
          saving
            ? t('manualHistory.form.saving')
            : isCorrection
              ? t('manualHistory.form.saveCorrection')
              : t('manualHistory.form.save')
        }
      />
      <Button
        disabled={saving}
        onPress={onClose}
        testID="manual-history-form-close"
        title={t('manualHistory.form.close')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { backgroundColor: 'white', borderRadius: 10, gap: 10, padding: 14 },
  sectionTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  fieldLabel: { color: '#17212b', fontWeight: '600' },
  input: {
    borderColor: '#a8b3bf',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  detailsInput: { minHeight: 72, textAlignVertical: 'top' },
});
