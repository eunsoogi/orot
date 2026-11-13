import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** A compact transcript surface uses semantic colors in both system appearances. */
export const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'flex-start',
    minWidth: 56,
    height: 36,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 18,
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: appColors.secondary,
  },
});
