import { Platform, PlatformColor } from 'react-native';
import { appColors } from '../layout/appColors';

/** Settings uses the semantic UIKit list surfaces in both iOS appearances. */
export const settingsListColors = {
  background:
    Platform.OS === 'ios'
      ? PlatformColor('systemGroupedBackground')
      : appColors.background,
  row:
    Platform.OS === 'ios'
      ? PlatformColor('secondarySystemGroupedBackground')
      : appColors.surface,
  separator:
    Platform.OS === 'ios' ? PlatformColor('separator') : appColors.border,
};
