import { StyleSheet } from 'react-native';
import {
  NAVIGATION_ACTION_TOP_PADDING,
  NAVIGATION_ACTION_BOTTOM_PADDING,
} from './navigationLayout';

export const bottomNavigationMenuStyles = StyleSheet.create({
  container: {
    flexShrink: 0,
    paddingHorizontal: 20,
    paddingTop: NAVIGATION_ACTION_TOP_PADDING,
    paddingBottom: NAVIGATION_ACTION_BOTTOM_PADDING,
  },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
