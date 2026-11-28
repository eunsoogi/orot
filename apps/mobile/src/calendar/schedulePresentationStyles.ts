import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Layout overrides for the Schedule route; standalone calendar linking keeps its own styling. */
export const schedulePresentationStyles = StyleSheet.create({
  flatMonthButton: { backgroundColor: 'transparent' },
  flatSelectedDay: { backgroundColor: appColors.primaryAction },
  flatSelectedDayNumber: { color: appColors.onPrimary, fontWeight: '600' },
  flatTodayDay: { borderColor: appColors.primaryText, borderWidth: 1 },
  flatVisitMarker: { backgroundColor: appColors.warning },
  flatSelectedEventMarker: { backgroundColor: appColors.onPrimary },
  flatAgenda: { gap: 6, paddingHorizontal: 0, paddingTop: 12 },
  flatAgendaList: { gap: 0 },
  flatEventRow: {
    alignItems: 'center',
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minWidth: 0,
    paddingVertical: 10,
  },
  flatEventRowLargeText: { alignItems: 'stretch', flexDirection: 'column' },
  flatEventCopy: { flex: 1, gap: 3, minWidth: 0 },
  flatEventTime: { color: appColors.secondary, fontSize: 14 },
  flatNextVisit: { gap: 4, paddingVertical: 10 },
});
