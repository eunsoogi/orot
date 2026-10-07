import { Pressable, StyleSheet, View } from 'react-native';
import type {
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { DesignIcon } from './DesignIcon';
import type { DesignIconName } from './DesignIcon';
import { DesignText } from './DesignText';
import { designTokens, useAppTheme } from './tokens';

export type DesignButtonVariant = 'primary' | 'secondary' | 'quiet' | 'icon';

interface DesignButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: DesignButtonVariant;
  icon?: DesignIconName;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: designTokens.radii.control,
    flexDirection: 'row',
    gap: designTokens.spacing.sm,
    justifyContent: 'center',
    minHeight: designTokens.minTouchTarget,
    minWidth: designTokens.minTouchTarget,
    paddingHorizontal: designTokens.spacing.lg,
  },
  buttonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.spacing.sm,
  },
  buttonLabel: { flexShrink: 1, textAlign: 'center' },
  iconButton: {
    paddingHorizontal: designTokens.spacing.sm,
  },
  pressed: { opacity: 0.78 },
});

export function DesignButton({
  accessibilityLabel,
  disabled = false,
  icon,
  label,
  style,
  variant = 'primary',
  ...pressableProps
}: DesignButtonProps) {
  const theme = useAppTheme();
  const iconOnly = variant === 'icon';
  const backgroundColor = disabled
    ? theme.colors.surfaceSubtle
    : variant === 'primary'
      ? theme.colors.accent
      : variant === 'secondary'
        ? theme.colors.accentSubtle
        : theme.colors.surfaceSubtle;
  const textTone = disabled
    ? 'secondary'
    : variant === 'primary'
      ? 'onAccent'
      : 'accent';
  const iconTone = disabled
    ? 'textMuted'
    : variant === 'primary'
      ? 'onAccent'
      : 'accent';

  // Shared actions keep a 44pt target even when the visual treatment is icon-only.
  return (
    <Pressable
      {...pressableProps}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      style={(state: PressableStateCallbackType) =>
        buttonStyle(state, {
          backgroundColor,
          disabled,
          iconOnly,
          style,
        })
      }
    >
      <View style={styles.buttonContent}>
        {icon ? <DesignIcon name={icon} tone={iconTone} /> : null}
        {!iconOnly ? (
          <DesignText
            style={styles.buttonLabel}
            tone={textTone}
            variant="button"
          >
            {label}
          </DesignText>
        ) : null}
      </View>
    </Pressable>
  );
}

function buttonStyle(
  state: PressableStateCallbackType,
  options: {
    backgroundColor: string;
    disabled: boolean;
    iconOnly: boolean;
    style: StyleProp<ViewStyle>;
  },
) {
  return [
    styles.button,
    options.style,
    options.iconOnly && styles.iconButton,
    { backgroundColor: options.backgroundColor },
    state.pressed && !options.disabled && styles.pressed,
  ];
}
