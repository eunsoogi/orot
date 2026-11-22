import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';
import { hubSpacing } from '../layout/hubSpacing';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';

export const recordsRouteStyles = StyleSheet.create({
  transition: { flexGrow: 1, minWidth: 0 },
  container: {
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: appColors.background,
  },
  page: {
    gap: hubSpacing.item,
    paddingHorizontal: hubSpacing.horizontal,
    paddingTop: hubSpacing.top,
    // The route scroller already supplies the shared readable gap above navigation.
    paddingBottom: hubSpacing.bottom - NAVIGATION_CONTENT_GAP,
  },
  pageAfterBanner: { paddingTop: hubSpacing.item },
  primaryPanel: { minWidth: 0, gap: hubSpacing.item },
  status: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
});
