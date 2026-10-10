import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const recordingControlStyles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: appColors.background,
  },
  back: { alignSelf: 'flex-start' },
  title: { color: appColors.text, fontSize: 24, fontWeight: '700' },
  copy: { color: appColors.secondary, fontSize: 16, lineHeight: 22 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { color: appColors.text, fontSize: 22 },
  status: { color: appColors.text, fontSize: 18, fontWeight: '700' },
  duration: { color: appColors.secondary, fontSize: 16 },
  result: { gap: 8 },
  error: { color: appColors.danger, fontSize: 15 },
  probe: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
});
