import { StyleSheet, View } from 'react-native';
import { appColors } from '../layout/appColors';

/** Decorative full-row separation; never an extra accessibility or touch target. */
export function SettingsNotificationDivider({ inset = 0 }: { inset?: number }) {
  return (
    <View
      accessible={false}
      pointerEvents="none"
      importantForAccessibility="no"
      testID="settings-notification-divider"
      style={[styles.horizontal, { marginHorizontal: inset }]}
    />
  );
}
const styles = StyleSheet.create({
  horizontal: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: appColors.border,
  },
});
