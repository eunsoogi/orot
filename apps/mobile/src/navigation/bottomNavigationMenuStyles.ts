import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';
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
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    alignItems: 'center',
    borderColor: appColors.border,
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: 50,
    minWidth: 72,
    borderRadius: 24,
    paddingHorizontal: 8,
  },
  darkAction: { borderColor: '#ffffff' },
  primaryAction: {
    backgroundColor: appColors.primaryAction,
    borderColor: appColors.primaryAction,
  },
  label: { color: appColors.primaryText, fontSize: 15, fontWeight: '600' },
  darkLabel: { color: '#ffffff' },
  primaryLabel: { color: appColors.onPrimary },
  disabled: { opacity: 0.5 },
});
