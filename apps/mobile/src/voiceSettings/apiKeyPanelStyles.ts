import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Filled groups match account settings; labels stay visible while the secret remains masked. */
export const apiKeyPanelStyles = StyleSheet.create({
  section: { gap: 12 },
  panel: {
    gap: 20,
    padding: 16,
    borderRadius: 20,
    backgroundColor: appColors.surface,
  },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: appColors.text },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: appColors.text,
    backgroundColor: appColors.background,
    borderRadius: 14,
  },
  guidance: { gap: 8, paddingHorizontal: 12 },
});
