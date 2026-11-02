import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';

/** Shared card and chart geometry stays inside the Home route's single scroll owner. */
export const homeMetricStyles = StyleSheet.create({
  section: { gap: 12 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  edit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 6,
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 140,
  },
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
