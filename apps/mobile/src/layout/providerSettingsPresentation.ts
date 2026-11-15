import { StyleSheet } from 'react-native';
import { appColors } from './appColors';

/** Shared visual contract for provider headings, account headers and model choices. */
export const providerSettingsStyles = StyleSheet.create({
  section: { gap: 12, marginTop: 22 },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: appColors.text,
    paddingHorizontal: 4,
  },
  account: {
    gap: 8,
    padding: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: appColors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '600', color: appColors.text },
  secondary: { fontSize: 13, color: appColors.secondary },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  action: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 82,
    padding: 16,
    borderColor: appColors.border,
    borderWidth: 1,
    borderRadius: 20,
    backgroundColor: appColors.surface,
  },
  detail: { color: appColors.secondary, fontSize: 14 },
});
