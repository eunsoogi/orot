import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { homeMetricGridGap } from './homeMetricLayout';

/** Shared card and chart geometry stays inside the Home route's single scroll owner. */
export const homeMetricStyles = StyleSheet.create({
  section: { gap: 12 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Large system text must wrap before it can push the edit action offscreen.
    flexWrap: 'wrap',
  },
  edit: {
    minWidth: 44,
    minHeight: 44,
    maxWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: appColors.text,
    fontSize: 17,
    fontWeight: '700',
    flexShrink: 1,
    maxWidth: '100%',
  },
  grid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: homeMetricGridGap,
  },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  recentChange: { alignSelf: 'stretch', maxWidth: '100%' },
  recentChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentChangeStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  comparisonIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    flexBasis: 78,
    flexShrink: 1,
    minWidth: 48,
    maxWidth: 78,
    gap: 6,
  },
  comparisonDivider: {
    alignSelf: 'stretch',
    width: StyleSheet.hairlineWidth,
    backgroundColor: appColors.border,
  },
  comparisonPeriods: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  comparisonPeriodsStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    // Preserve full-width values and dates when space or scaled text is constrained.
  },
  comparisonTitle: {
    color: appColors.text,
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  comparisonStatistic: { color: appColors.secondary, flexShrink: 1 },
  comparisonPeriod: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  comparisonPeriodStacked: { alignItems: 'flex-start' },
  comparisonPeriodLabel: {
    color: appColors.text,
    fontWeight: '600',
    flexShrink: 1,
  },
  comparisonDateRange: { color: appColors.secondary, flexShrink: 1 },
  comparisonValue: {
    color: appColors.text,
    fontSize: 17,
    fontWeight: '700',
    flexShrink: 1,
  },
  comparisonSummary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 2,
    flexShrink: 1,
  },
  comparisonSummaryLabel: {
    color: appColors.secondary,
    fontSize: 13,
    flexShrink: 1,
  },
  comparisonSummaryCoverage: {
    color: appColors.secondary,
    fontSize: 13,
    flexShrink: 1,
  },
  comparisonArrow: {
    color: appColors.secondary,
    fontSize: 20,
    flexShrink: 0,
  },
  comparisonCoverage: { color: appColors.secondary, flexShrink: 1 },
  comparisonMetadata: { color: appColors.secondary, flexShrink: 1 },
  selectionPanel: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  selectionPrompt: { marginBottom: 4 },
  selectionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: appColors.border,
  },
  selectionRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    // Match Health Data's comfortable checkbox row target at larger text sizes.
    minHeight: 68,
    paddingVertical: 10,
  },
  selectionLabel: { flex: 1, gap: 3, minWidth: 0 },
  selectionTitle: { color: appColors.text, fontSize: 15, fontWeight: '500' },
  selectionStatus: {
    color: appColors.secondary,
    fontSize: 12,
    lineHeight: 18,
  },
  selectionMark: {
    alignItems: 'center',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  selectionMarkSelected: { backgroundColor: appColors.primary },
  // Equal button slots stay paired when they fit and wrap into a stack when narrow.
  selectionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  selectionActionSlot: {
    flexBasis: 140,
    flexGrow: 1,
    minWidth: 128,
  },
  gridCard: { flexGrow: 0, flexShrink: 0 },
  cardTitle: { color: appColors.text, fontWeight: '700' },
  metricHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metricIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: appColors.purpleSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { color: appColors.text, fontSize: 20, fontWeight: '700' },
  detail: { color: appColors.secondary, fontSize: 12 },
  chart: { flexDirection: 'row', gap: 3 },
  column: { flex: 1, alignItems: 'center' },
  barSpace: { height: 36, width: '80%', justifyContent: 'flex-end' },
  bar: { backgroundColor: appColors.secondary, width: '100%' },
  date: { color: appColors.secondary, fontSize: 9 },
});
