import { Pressable, StyleSheet, Text, type ButtonProps } from 'react-native';
import { appColors } from './appColors';

/** Product buttons retain async accessibility state and allow multiline accessible labels. */
export function AppButton({
  title,
  color,
  disabled,
  onPress,
  testID,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  variant = 'primary',
}: ButtonProps & { readonly variant?: 'primary' | 'secondary' }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        ...accessibilityState,
        disabled: Boolean(disabled),
      }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' && styles.secondary,
        color ? { backgroundColor: color } : null,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Text
        style={[styles.label, variant === 'secondary' && styles.secondaryLabel]}
      >
        {title}
      </Text>
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
  // Secondary actions keep the same touch target while letting grouped rows stay quiet.
  secondary: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
  },
  secondaryLabel: { color: appColors.primaryText },
});
