import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export default StyleSheet.create({
  keyboardAvoider: { flex: 1 },
  container: {
    gap: 12,
    padding: 20,
    paddingTop: 20,
    backgroundColor: appColors.background,
    minHeight: '100%',
  },
  primaryPanel: { gap: 12, minWidth: 0 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  sectionTitle: { color: appColors.text, fontSize: 15, fontWeight: '600' },
  message: { color: appColors.secondary, fontSize: 15 },
  hint: { color: appColors.secondary, fontSize: 13 },
  error: { color: appColors.danger },
});
