import { Platform, PlatformColor } from 'react-native';
import { appColors } from '../layout/appColors';

/** Share the app card surface; keep the platform separator independent of the fill. */
export const settingsListColors = {
  background: appColors.background,
  row: appColors.surface,
  separator:
    Platform.OS === 'ios' ? PlatformColor('separator') : appColors.border,
};
