import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { t } from '../i18n';
import { ManualHistoryDateControls } from './ManualHistoryDateControls';
import type {
  ManualHistoryScreenDraft,
  ManualHistoryScreenRecord,
} from './types';
import { MANUAL_HISTORY_KINDS } from './types';
import type { ManualHistoryScreenFormDraft } from './types';
import {
  MANUAL_HISTORY_FORM_MAX_WIDTH,
  manualHistorySupportsInlineDateControls,
} from './ManualHistoryFormLayout';

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
  const [availableWidth, setAvailableWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const inlineDateControls = manualHistorySupportsInlineDateControls(
    availableWidth,
    fontScale,
  );

  const measureAvailableWidth = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    // Ignore sub-point layout noise so controls reflow only when the lane changes materially.
    setAvailableWidth(previous =>
      Math.abs(previous - nextWidth) < 0.5 ? previous : nextWidth,
    );
  }, []);

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
    <View
      onLayout={measureAvailableWidth}
      style={styles.form}
      testID="manual-history-form"
    >
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
      <ManualHistoryDateControls
        dateUnknown={dateUnknown}
        effectiveDate={effectiveDate}
        inline={inlineDateControls}
        onEffectiveDateChange={value => {
          setEffectiveDate(value);
          setDateUnknown(false);
        }}
        onToggleDateKnowledge={() => {
          setDateUnknown(!dateUnknown);
          if (!dateUnknown) setEffectiveDate('');
        }}
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
  form: {
    alignSelf: 'center',
    backgroundColor: 'white',
    borderRadius: 10,
    gap: 10,
    maxWidth: MANUAL_HISTORY_FORM_MAX_WIDTH,
    padding: 14,
    width: '100%',
  },
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
