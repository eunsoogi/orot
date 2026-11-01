import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** The shell owns the background while route scenes and overlays resize. */
export const navigationRouteAdapterStyles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: appColors.background },
});
