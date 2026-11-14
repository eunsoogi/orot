import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const voiceSettingsStyles = StyleSheet.create({
  panel: {
    padding: 16,
    gap: 12,
    borderRadius: 16,
    backgroundColor: appColors.surface,
  },
  modelGroup: {
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 12,
  },
  title: { fontSize: 18, fontWeight: '600', color: appColors.text },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1 },
  refresh: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
