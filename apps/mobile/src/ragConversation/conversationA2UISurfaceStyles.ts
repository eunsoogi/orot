import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const a2uiSurfaceStyles = StyleSheet.create({
  surface: { minWidth: 0 },
  stack: { gap: 8, minWidth: 0 },
  card: {
    padding: 12,
    borderRadius: 12,
    gap: 8,
    minWidth: 0,
    backgroundColor: appColors.primarySoft,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    minWidth: 0,
  },
  column: { flex: 1, minWidth: 0 },
  naturalColumn: { flexShrink: 1, minWidth: 0, maxWidth: '100%' },
  divider: {
    backgroundColor: appColors.border,
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
  },
  verticalDivider: {
    backgroundColor: appColors.border,
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  tabList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, minWidth: 0 },
  tab: {
    minHeight: 44,
    maxWidth: '100%',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  selectedTab: { backgroundColor: appColors.primarySoft },
  body: { fontSize: 15, flexShrink: 1 },
  caption: { fontSize: 13, color: appColors.secondary, flexShrink: 1 },
});
