import { Pressable, StyleSheet } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';

export const classificationEdgeTarget = 44;

/** A fixed in-flow target, not a hit slop extending into the row or native rail. */
export function ClassificationEdgeAction({
  direction,
  label,
  testID,
  disabled = false,
  onPress,
}: {
  readonly direction: 'left' | 'right';
  readonly label: string;
  readonly testID: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.hit, disabled && styles.disabled]}
      testID={testID}
    >
      <AppSymbol
        name={direction === 'left' ? 'chevron.left' : 'chevron.right'}
        color={appColors.primaryText}
        size={20}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: classificationEdgeTarget,
    height: classificationEdgeTarget,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
});
