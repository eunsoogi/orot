import { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ManualHistoryKindControls } from './ManualHistoryKindControls';
import { styles } from './manualHistoryFormStyles';
import { t } from '../i18n';
import { ManualHistoryDateControls } from './ManualHistoryDateControls';
import type {
  ManualHistoryScreenDraft,
  ManualHistoryScreenRecord,
} from './types';
import type { ManualHistoryScreenFormDraft } from './types';
import { manualHistorySupportsInlineDateControls } from './ManualHistoryFormLayout';

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
  const [detailsHeight, setDetailsHeight] = useState(96);
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

  useEffect(() => {
    if (validationError)
      AccessibilityInfo.announceForAccessibility(validationError);
  }, [validationError]);

  async function save() {
    if (saving) return;
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
      <ManualHistoryKindControls
        kind={kind}
        onChange={setKind}
        disabled={saving}
        inline={inlineDateControls}
      />
      <Text style={styles.fieldLabel}>
        {t('manualHistory.form.titleLabel')} {t('manualHistory.form.required')}
      </Text>
      <TextInput
        editable={!saving}
        placeholderTextColor={appColors.secondary}
        accessibilityLabel={t('manualHistory.form.titleLabel')}
        onChangeText={setTitle}
        placeholder={t('manualHistory.form.titlePlaceholder')}
        style={styles.input}
        testID="manual-history-title-input"
        value={title}
      />
      <Text style={styles.fieldLabel}>
        {t('manualHistory.form.detailsLabel')}{' '}
        {t('manualHistory.form.required')}
      </Text>
      <TextInput
        editable={!saving}
        placeholderTextColor={appColors.secondary}
        accessibilityLabel={t('manualHistory.form.detailsLabel')}
        multiline
        scrollEnabled={false}
        // The page owns scrolling; growing content must never become an independent editor viewport.
        onContentSizeChange={event =>
          setDetailsHeight(Math.max(96, event.nativeEvent.contentSize.height))
        }
        onChangeText={setDetails}
        placeholder={t('manualHistory.form.detailsPlaceholder')}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        style={[
          styles.input,
          styles.detailsInput,
          { minHeight: detailsHeight },
        ]}
        testID="manual-history-details-input"
        value={details}
      />
      <ManualHistoryDateControls
        disabled={saving}
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
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            {t('manualHistory.form.correctionNoteLabel')}
          </Text>
          <TextInput
            editable={!saving}
            placeholderTextColor={appColors.secondary}
            accessibilityLabel={t('manualHistory.form.correctionNoteLabel')}
            onChangeText={setCorrectionNote}
            placeholder={t('manualHistory.form.correctionNotePlaceholder')}
            style={styles.input}
            testID="manual-history-correction-note-input"
            value={correctionNote}
          />
        </View>
      ) : null}
      {validationError ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.error}
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
        variant="secondary"
        disabled={saving}
        onPress={onClose}
        testID="manual-history-form-close"
        title={t('manualHistory.form.close')}
      />
    </View>
  );
}
