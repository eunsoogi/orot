import { Pressable, StyleSheet, Text } from 'react-native';
import { appColors } from '../layout/appColors';

interface NavigationActionButtonProps {
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
  readonly isDarkAppearance: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
  readonly testID: string;
}

/** Keeps detail actions readable over the shared native glass surface. */
export function NavigationActionButton({
  accessibilityLabel,
  disabled,
  isDarkAppearance,
  label,
  onPress,
  primary = false,
  testID,
}: NavigationActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        isDarkAppearance && !primary && styles.darkAction,
        primary && styles.primaryAction,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.label,
          isDarkAppearance && !primary && styles.darkLabel,
          primary && styles.primaryLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderColor: appColors.border,
    borderRadius: 24,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 50,
    minWidth: 72,
    paddingHorizontal: 8,
  },
  darkAction: { borderColor: '#ffffff' },
  primaryAction: {
    backgroundColor: appColors.primaryAction,
    borderColor: appColors.primaryAction,
  },
  disabled: { opacity: 0.55 },
  label: {
    color: appColors.primaryText,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  darkLabel: { color: '#f7f8fa' },
  primaryLabel: { color: appColors.onPrimary },
});
