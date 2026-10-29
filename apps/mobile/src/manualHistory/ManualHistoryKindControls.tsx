import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { MANUAL_HISTORY_KINDS, type ManualHistoryScreenRecord } from './types';

/** Wraps measured choices and exposes selection independently from color. */
export function ManualHistoryKindControls({
  kind,
  onChange,
  disabled,
  inline,
}: {
  readonly kind: ManualHistoryScreenRecord['kind'];
  readonly onChange: (value: ManualHistoryScreenRecord['kind']) => void;
  readonly disabled: boolean;
  readonly inline: boolean;
}) {
  return (
    <View style={[styles.choices, inline && styles.inline]}>
      {MANUAL_HISTORY_KINDS.map(value => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityState={{ selected: kind === value, disabled }}
          disabled={disabled}
          onPress={() => onChange(value)}
          style={[styles.choice, kind === value && styles.selected]}
          testID={'manual-history-kind-' + value}
        >
          <Text style={kind === value ? styles.selectedText : styles.text}>
            {(kind === value ? '✓ ' : '') +
              t(
                ('manualHistory.kind.' +
                  value) as `manualHistory.kind.${ManualHistoryScreenRecord['kind']}`,
              )}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  choices: { gap: 8 },
  inline: { flexDirection: 'row', flexWrap: 'wrap' },
  choice: {
    minHeight: 48,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: appColors.primarySoft,
    borderColor: appColors.primaryText,
  },
  text: { color: appColors.text, fontSize: 16 },
  selectedText: {
    color: appColors.primaryText,
    fontWeight: '600',
    fontSize: 16,
  },
});
