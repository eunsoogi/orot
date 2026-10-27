import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const medicationSelectionStyles = StyleSheet.create({
  content: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  scroll: { flex: 1, minHeight: 0 },
  header: { gap: 14, marginBottom: 8 },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    color: appColors.text,
    flexShrink: 1,
    fontSize: 28,
    fontWeight: '700',
  },
  description: { color: appColors.secondary, lineHeight: 20 },
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  period: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectedPeriod: {
    backgroundColor: appColors.primaryAction,
    borderColor: appColors.primaryAction,
  },
  periodText: { color: appColors.text, fontSize: 13 },
  selectedPeriodText: { color: appColors.onPrimary, fontWeight: '700' },
  count: { color: appColors.secondary, fontSize: 13 },
  error: { color: appColors.danger, marginBottom: 8 },
  option: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    minHeight: 56,
    padding: 14,
  },
  selectedOption: { borderColor: appColors.primaryAction, borderWidth: 2 },
  optionTitle: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  optionDetail: { color: appColors.secondary, fontSize: 13 },
});

export const medicationHistoryStyles = StyleSheet.create({
  content: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  scroll: { flex: 1, minHeight: 0 },
  header: { gap: 14, marginBottom: 8 },
  historyTitle: { color: appColors.text, fontSize: 22, fontWeight: '700' },
  optionTitle: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  optionDetail: { color: appColors.secondary, fontSize: 13 },
  medicationSummary: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
});
