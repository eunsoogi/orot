import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const healthRecordsDetailStyles = StyleSheet.create({
  container: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  header: { gap: 14, marginBottom: 8 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: { color: appColors.text, fontSize: 24, fontWeight: '700' },
  description: { color: appColors.secondary, lineHeight: 20 },
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  period: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: 1,
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
});
