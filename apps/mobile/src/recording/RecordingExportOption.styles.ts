import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const recordingExportOptionStyles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 14,
    minHeight: 112,
    padding: 16,
  },
  disabled: { opacity: 0.55 },
  iconTile: {
    alignItems: 'center',
    borderRadius: 14,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  audioTile: { backgroundColor: appColors.primarySoft },
  transcriptTile: { backgroundColor: appColors.greenSoft },
  copy: { flex: 1, gap: 5 },
  title: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  description: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  trailing: { alignItems: 'center', flexDirection: 'row', gap: 8 },
});
