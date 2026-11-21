import { StyleSheet } from 'react-native';
import { appColors } from './appColors';

/** Shared ring and fill from the Recording primary control. Geometry is owned by each route. */
export const roundPrimaryActionStyles = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.primarySoft,
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.primaryAction,
  },
});

export const roundPrimaryActionDiameter = 160;
