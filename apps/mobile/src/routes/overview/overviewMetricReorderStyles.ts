import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';

/** Keep the selection row's painted and accessibility action order independent. */
export const overviewMetricReorderStyles = StyleSheet.create({
  // Place the handle on the leading edge without changing control order.
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  checkbox: { flex: 1, minWidth: 0 },
  handle: {
    alignSelf: 'stretch',
    minHeight: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragged: { zIndex: 1 },
  dragSurface: { backgroundColor: appColors.surface },
  target: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: appColors.primary,
  },
  targetBefore: { top: 0 },
  targetAfter: { bottom: 0 },
});
