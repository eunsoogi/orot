import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';

/** Provider cards and outcomes share the adaptive palette of the other import routes. */
export const unifiedImportStyles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: appColors.background },
  container: { flexGrow: 1, padding: 24, gap: 20 },
  panel: { flex: 1, minWidth: 0, gap: 12 },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  description: { color: appColors.secondary, fontSize: 17, lineHeight: 25 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  provider: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  providerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.primarySoft,
  },
  providerText: { flex: 1, gap: 4 },
  sectionTitle: { color: appColors.text, fontSize: 17, fontWeight: '600' },
  caption: { color: appColors.secondary, fontSize: 14, lineHeight: 21 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    gap: 4,
  },
  selectedOption: {
    borderColor: appColors.primaryAction,
    backgroundColor: appColors.primarySoft,
  },
  outcome: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: appColors.border,
    gap: 4,
  },
  optionHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  optionLabel: { color: appColors.text, fontSize: 14 },
  status: { color: appColors.secondary, fontSize: 14, lineHeight: 21 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noticeText: {
    flex: 1,
    color: appColors.secondary,
    fontSize: 14,
    lineHeight: 22,
  },
  section: { gap: 12 },
  // Pair the panel's 12-point gap with 8 points to keep the 20-point header rhythm.
  headerSection: { gap: 12, marginBottom: 8 },
  candidate: {
    padding: 16,
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
  },
  selectedCandidate: { borderColor: appColors.primaryAction },
  error: { color: appColors.danger, fontSize: 14, lineHeight: 22 },
});
