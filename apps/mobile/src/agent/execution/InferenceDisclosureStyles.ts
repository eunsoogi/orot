import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';

/** The selected permission mock uses quiet grouped cards and a fixed, reachable action footer. */
export const disclosureStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  panel: {
    // The system sheet supplies its own presentation height and rounded edge.
    flex: 1,
    backgroundColor: appColors.background,
    overflow: 'hidden',
  },
  grabber: {
    // Reserve the previous 26pt top inset outside the scroller so text cannot cover the cue.
    marginTop: 8,
    marginBottom: 13,
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: appColors.secondary,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 14,
  },
  header: { gap: 12 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: appColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 24 },
  card: {
    padding: 18,
    backgroundColor: appColors.surface,
    borderRadius: 18,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
  },
  row: { gap: 4 },
  label: { color: appColors.secondary, fontSize: 13, lineHeight: 18 },
  value: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: appColors.border,
  },
  expand: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  expandText: { flex: 1, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  notice: { gap: 5 },
  noticeTitle: { fontSize: 15, lineHeight: 23, fontWeight: '600' },
  noticeBody: { color: appColors.secondary, fontSize: 14, lineHeight: 22 },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  footerNote: {
    color: appColors.secondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginVertical: 8 },
  message: {
    gap: 6,
    padding: 12,
    backgroundColor: appColors.surface,
    marginBottom: 8,
    borderRadius: 12,
  },
  code: { fontFamily: 'monospace', fontSize: 12 },
  error: { color: appColors.danger, fontSize: 14, lineHeight: 22 },
});
