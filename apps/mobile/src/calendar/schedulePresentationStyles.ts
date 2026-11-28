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
  dayInGrid: { width: '100%' },
  fullDateFace: { aspectRatio: undefined, maxWidth: undefined },
  flatEventTime: { color: appColors.secondary, fontSize: 14 },
  flatNextVisit: { gap: 4, paddingVertical: 10 },
});
