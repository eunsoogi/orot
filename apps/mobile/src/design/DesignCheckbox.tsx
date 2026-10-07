import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableProps } from 'react-native';
import { DesignText } from './DesignText';
import { designTokens, useAppTheme } from './tokens';

interface DesignCheckboxProps extends Omit<
  PressableProps,
  'children' | 'style'
> {
  label: string;
  checked: boolean;
}

/** The full wrapping label is tappable; a geometric check also exposes state without color. */
export function DesignCheckbox({
  label,
  checked,
  disabled = false,
  ...props
}: DesignCheckboxProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      {...props}
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surfaceSubtle, opacity: pressed ? 0.78 : 1 },
      ]}
    >
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.box,
          {
            backgroundColor: checked ? colors.accent : colors.surface,
            borderColor: colors.accent,
          },
        ]}
      >
        {checked ? (
          <View style={[styles.check, { borderColor: colors.onAccent }]} />
        ) : null}
      </View>
      <DesignText style={styles.label}>{label}</DesignText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: designTokens.radii.control,
    flexDirection: 'row',
    gap: designTokens.spacing.md,
    minHeight: designTokens.minTouchTarget,
    minWidth: designTokens.minTouchTarget,
    padding: designTokens.spacing.md,
  },
  label: { flex: 1 },
  box: {
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  check: {
    borderBottomWidth: 2,
    borderRightWidth: 2,
    height: 10,
    marginBottom: 3,
    transform: [{ rotate: '45deg' }],
    width: 6,
  },
});
