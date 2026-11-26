import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import {
  localA2UIChoiceClearLabel,
  localA2UIChoiceLabel,
  localA2UIChoices,
} from './conversationA2UILocalDraft';

/** This live owner supplies the only callback; no model action is rendered. */
export function ConversationA2UILocalChoice({
  value,
  onChange,
  label = localA2UIChoiceLabel,
  optionLabels,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label?: string;
  readonly optionLabels?: readonly [string, string];
}) {
  return (
    <View style={styles.group}>
      <AppText allowFontScaling>{label}</AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={label}>
        {localA2UIChoices.map((option, index) => {
          const optionLabel = optionLabels?.[index] ?? option.label;
          const checked = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={optionLabel}
              accessibilityState={{ checked }}
              onPress={() => onChange(option.value)}
              style={checked ? [styles.option, styles.checked] : styles.option}
            >
              <AppText allowFontScaling>{optionLabel}</AppText>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={localA2UIChoiceClearLabel}
        accessibilityState={{ disabled: !value }}
        disabled={!value}
        onPress={() => onChange('')}
        style={styles.option}
      >
        <AppText allowFontScaling>{localA2UIChoiceClearLabel}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8, marginTop: 8 },
  option: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  checked: { backgroundColor: appColors.primarySoft, borderRadius: 8 },
});
