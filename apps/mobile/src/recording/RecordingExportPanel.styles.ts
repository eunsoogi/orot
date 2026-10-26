import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const recordingExportPanelStyles = StyleSheet.create({
  panel: { gap: 14 },
  subtitle: {
    color: appColors.secondary,
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 10,
  },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  privacyNote: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
  },
  privacyCopy: {
    color: appColors.secondary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  error: { color: appColors.danger, fontSize: 14 },
});
