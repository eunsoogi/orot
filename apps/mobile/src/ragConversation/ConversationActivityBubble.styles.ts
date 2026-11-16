import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Filled grouping separates decorative activity dots without implying an outlined control. */
export const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'flex-start',
    minWidth: 56,
    height: 36,
    paddingHorizontal: 14,
    borderWidth: 0,
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
