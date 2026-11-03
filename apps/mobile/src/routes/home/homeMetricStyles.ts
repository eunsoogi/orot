import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';

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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  gridCard: { flexGrow: 0, flexBasis: '48%', minWidth: 140 },
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
