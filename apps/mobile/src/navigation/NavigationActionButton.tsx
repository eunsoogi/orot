import { Pressable, StyleSheet } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';

interface NavigationActionButtonProps {
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
  readonly busy?: boolean;
  readonly isDarkAppearance: boolean;
  readonly symbol?: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
  readonly testID?: string;
}

/** Keep one accessible action name when the compact chrome only shows its symbol. */
export function NavigationActionButton({
  accessibilityLabel,
  disabled,
  busy,
  isDarkAppearance,
  symbol = 'ellipsis',
  onPress,
  primary = false,
  testID,
}: NavigationActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
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
      <AppSymbol
        name={symbol}
        size={20}
        color={
          primary
            ? appColors.onPrimary
            : isDarkAppearance
              ? '#f7f8fa'
              : appColors.primaryText
        }
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderColor: appColors.border,
    borderRadius: 24,
    borderWidth: 1,
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
});
