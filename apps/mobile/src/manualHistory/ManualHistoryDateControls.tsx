import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';

interface ManualHistoryDateControlsProps {
  readonly dateUnknown: boolean;
  readonly effectiveDate: string;
  readonly inline: boolean;
  readonly onEffectiveDateChange: (value: string) => void;
  readonly onToggleDateKnowledge: () => void;
}

/** Keeps an explicitly unknown date distinct from an empty known-date input. */
export function ManualHistoryDateControls({
  dateUnknown,
  effectiveDate,
  inline,
  onEffectiveDateChange,
  onToggleDateKnowledge,
}: ManualHistoryDateControlsProps) {
  return (
    <>
      <Text style={styles.fieldLabel}>{t('manualHistory.form.dateLabel')}</Text>
      <View
        style={[styles.controls, inline && styles.controlsInline]}
        testID="manual-history-date-controls"
      >
        {!dateUnknown ? (
          <TextInput
            accessibilityLabel={t('manualHistory.form.dateLabel')}
            onChangeText={onEffectiveDateChange}
            placeholder={t('manualHistory.form.datePlaceholder')}
            style={[styles.input, inline && styles.inlineControl]}
            testID="manual-history-effective-date-input"
            value={effectiveDate}
          />
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
    </>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { color: '#17212b', fontWeight: '600' },
  controls: { gap: 10 },
  controlsInline: { alignItems: 'center', flexDirection: 'row' },
  inlineControl: { flex: 1, minWidth: 0 },
  input: {
    borderColor: '#a8b3bf',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
});
