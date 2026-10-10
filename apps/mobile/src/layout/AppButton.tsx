import { Pressable, StyleSheet, Text, type ButtonProps } from 'react-native';
import { appColors } from './appColors';

/** Product buttons retain native button semantics while allowing multiline accessible labels. */
export function AppButton({
  title,
  color,
  disabled,
  onPress,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        color ? { backgroundColor: color } : null,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Text style={styles.label}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: appColors.primaryAction,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  label: {
    color: appColors.onPrimary,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24,
  },
  disabled: { opacity: 0.45 },
});
