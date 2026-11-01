import { StyleSheet } from 'react-native';
import {
  NAVIGATION_ACTION_BOTTOM_PADDING,
  NAVIGATION_ACTION_TOP_PADDING,
} from './navigationLayout';

/** The page and navigation groups share one overlay, with rail controls portal-mounted by UIKit. */
export const navigationActionBarStyles = StyleSheet.create({
  fill: { flex: 1 },
  host: { position: 'relative' },
  safeArea: {
    flexShrink: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
    paddingTop: NAVIGATION_ACTION_TOP_PADDING,
    paddingBottom: NAVIGATION_ACTION_BOTTOM_PADDING,
  },
  railHost: { overflow: 'visible', padding: 0 },
  railSurface: { height: '100%', width: '100%' },
  pageRail: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
