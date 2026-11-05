import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Keeps history panels flexible within their native measurement host. */
export const styles = StyleSheet.create({
  screen: { flex: 1, minWidth: 0, backgroundColor: appColors.background },
  pageContent: { flexGrow: 1 },
  measurementHost: { flexGrow: 1, minWidth: 0, minHeight: 0 },
  layout: { flexGrow: 1, minWidth: 0, minHeight: 0 },
  panel: { flexDirection: 'column' },
});
