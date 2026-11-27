import { Platform, PlatformColor } from 'react-native';
import { appColors } from '../layout/appColors';

/** Settings inherits the app canvas but keeps the semantic UIKit row surfaces. */
export const settingsListColors = {
  background: appColors.background,
  row:
    Platform.OS === 'ios'
      ? PlatformColor('secondarySystemGroupedBackground')
      : appColors.surface,
  separator:
    Platform.OS === 'ios' ? PlatformColor('separator') : appColors.border,
};
