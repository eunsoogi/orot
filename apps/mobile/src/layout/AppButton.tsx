import { Pressable, StyleSheet, Text, type ButtonProps } from 'react-native';
import { appColors } from './appColors';

/** Compact product actions keep a 48pt minimum and grow with multiline Dynamic Type labels. */
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
}: ButtonProps & { readonly variant?: 'primary' | 'secondary' | 'neutral' }) {
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
        variant !== 'primary' && styles.secondary,
        color ? { backgroundColor: color } : null,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.label,
          variant === 'secondary' && styles.secondaryLabel,
          variant === 'neutral' && styles.neutralLabel,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: appColors.primaryAction,
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  label: {
    color: appColors.onPrimary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
  disabled: { opacity: 0.45 },
  // Secondary actions keep the same touch target while letting grouped rows stay quiet.
  secondary: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
  },
  secondaryLabel: { color: appColors.primaryText },
  // Peer actions share a neutral surface and label, without implying a preferred operation.
  neutralLabel: { color: appColors.text },
});
