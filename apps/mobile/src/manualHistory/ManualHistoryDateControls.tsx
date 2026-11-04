import { useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
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

/** A dismissed sheet leaves the form draft untouched; only Done returns a date. */
export function ManualHistoryDateControls({
  disabled,
  dateUnknown,
  effectiveDate,
  inline,
  onEffectiveDateChange,
  onToggleDateKnowledge,
}: ManualHistoryDateControlsProps) {
  const [request, setRequest] = useState({ id: 0, date: '' });
  const pending = useRef(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{t('manualHistory.form.dateLabel')}</Text>
      <View
        style={[styles.controls, inline && styles.controlsInline]}
        testID="manual-history-date-controls"
      >
        {!dateUnknown ? (
          <View style={inline && styles.inlineControl}>
            <Button
              variant="secondary"
              disabled={disabled}
              title={effectiveDate || t('manualHistory.form.chooseDate')}
              onPress={() => {
                if (pending.current) return;
                pending.current = true;
                setRequest(previous => ({
                  id: previous.id + 1,
                  date: effectiveDate,
                }));
              }}
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
            onPress={onToggleDateKnowledge}
            testID="manual-history-date-unknown"
            title={
              dateUnknown
                ? t('manualHistory.form.enterKnownDate')
                : t('manualHistory.form.markDateUnknown')
            }
          />
        </View>
      </View>
      {/* Keep the anchor mounted when date knowledge changes so an old request cannot replay. */}
      <ManualHistoryDatePicker
        request={request}
        onResult={result => {
          pending.current = false;
          if (result.date) onEffectiveDateChange(result.date);
          if (result.error) {
            Alert.alert(t('manualHistory.form.datePickerError'));
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  fieldLabel: { color: appColors.text, fontWeight: '600' },
  controls: { gap: 10 },
  controlsInline: { alignItems: 'center', flexDirection: 'row' },
  inlineControl: { flex: 1, minWidth: 0 },
});
