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
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <View style={styles.group}>
      <AppText allowFontScaling>{localA2UIChoiceLabel}</AppText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={localA2UIChoiceLabel}
      >
        {localA2UIChoices.map(option => {
          const checked = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked }}
              onPress={() => onChange(option.value)}
              style={checked ? [styles.option, styles.checked] : styles.option}
            >
              <AppText allowFontScaling>{option.label}</AppText>
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
