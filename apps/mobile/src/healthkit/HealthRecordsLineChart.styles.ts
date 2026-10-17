import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const healthRecordsChartStyles = StyleSheet.create({
  container: { gap: 8 },
  chartRow: { flexDirection: 'row', gap: 4 },
  unitLabel: { color: appColors.secondary, fontSize: 12 },
  axis: { alignItems: 'flex-end', justifyContent: 'space-between', width: 34 },
  axisLabel: { color: appColors.secondary, fontSize: 11 },
  plot: { flex: 1, position: 'relative' },
  gridLine: {
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  lineSegment: {
    height: 2,
    position: 'absolute',
  },
  point: { borderRadius: 6, height: 12, position: 'absolute', width: 12 },
  pointLabel: {
    fontSize: 12,
    fontWeight: '700',
    position: 'absolute',
    width: 34,
  },
  dateAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  dateLabel: { color: appColors.secondary, fontSize: 11 },
  legend: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  legendDot: { borderRadius: 4, height: 8, width: 8 },
  legendLabel: { color: appColors.secondary, fontSize: 12 },
  measuredOnly: { color: appColors.secondary, fontSize: 12, lineHeight: 18 },
});
