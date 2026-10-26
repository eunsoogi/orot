import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';

/** The native label and symbol share one accessible 58-point recording control. */
export default function RecordingSessionAction({
  title,
  icon,
  disabled,
  onPress,
  testID,
  secondary = false,
}: {
  readonly title: string;
  readonly icon: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
  readonly secondary?: boolean;
}) {
  const color = secondary ? appColors.text : appColors.onPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.control,
        secondary && styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      <AppSymbol name={icon} size={20} color={color} />
      <AppText style={[styles.label, { color }]}>{title}</AppText>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: appColors.primaryAction,
  },
  secondary: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'center',
  },
  disabled: { opacity: 0.45 },
});
