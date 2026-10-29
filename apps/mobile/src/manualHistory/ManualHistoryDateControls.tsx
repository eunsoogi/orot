import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ManualHistoryDatePicker } from './ManualHistoryDatePicker';
import { t } from '../i18n';

interface ManualHistoryDateControlsProps {
  readonly disabled: boolean;
  readonly dateUnknown: boolean;
  readonly effectiveDate: string;
  readonly inline: boolean;
  readonly onEffectiveDateChange: (value: string) => void;
  readonly onToggleDateKnowledge: () => void;
}

/** Keeps an explicitly unknown date distinct from an empty known-date input. */
export function ManualHistoryDateControls({
  disabled,
  dateUnknown,
  effectiveDate,
  inline,
  onEffectiveDateChange,
  onToggleDateKnowledge,
}: ManualHistoryDateControlsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      <Text style={styles.fieldLabel}>{t('manualHistory.form.dateLabel')}</Text>
      <View
        style={[styles.controls, inline && styles.controlsInline]}
        testID="manual-history-date-controls"
      >
        {!dateUnknown ? (
          <View style={inline && styles.inlineControl}>
            <TextInput
              editable={!disabled}
              placeholderTextColor={appColors.secondary}
              accessibilityLabel={t('manualHistory.form.dateLabel')}
              onChangeText={onEffectiveDateChange}
              placeholder={t('manualHistory.form.datePlaceholder')}
              style={styles.input}
              testID="manual-history-effective-date-input"
              value={effectiveDate}
            />
            <Button
              variant="secondary"
              disabled={disabled}
              title={t('manualHistory.form.chooseDate')}
              onPress={() => setPickerOpen(!pickerOpen)}
              testID="manual-history-open-date-picker"
            />
          </View>
        ) : (
          <Text
            style={inline && styles.inlineControl}
            testID="manual-history-date-unknown-selected"
          >
            {t('manualHistory.form.dateUnknownSelected')}
          </Text>
        )}
        <View style={inline && styles.inlineControl}>
          <Button
            variant="secondary"
            disabled={disabled}
            accessibilityState={{ selected: dateUnknown }}
            onPress={() => {
              setPickerOpen(false);
              onToggleDateKnowledge();
            }}
            testID="manual-history-date-unknown"
            title={
              dateUnknown
                ? t('manualHistory.form.enterKnownDate')
                : t('manualHistory.form.markDateUnknown')
            }
          />
        </View>
      </View>
      {!dateUnknown && pickerOpen ? (
        <ManualHistoryDatePicker
          value={effectiveDate}
          disabled={disabled}
          onChange={value => {
            onEffectiveDateChange(value);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { color: appColors.text, fontWeight: '600' },
  controls: { gap: 10 },
  controlsInline: { alignItems: 'center', flexDirection: 'row' },
  inlineControl: { flex: 1, minWidth: 0 },
  input: {
    backgroundColor: appColors.surface,
    color: appColors.text,
    minHeight: 48,
    fontSize: 16,
    borderColor: appColors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
});
