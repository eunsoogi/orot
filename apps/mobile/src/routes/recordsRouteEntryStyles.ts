import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 12,
  },
  title: { flexShrink: 1 },
  captureGroup: { maxWidth: '100%', marginStart: 'auto' },
  captureAction: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 28,
    overflow: 'hidden',
  },
  captureContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  captureTitle: {
    color: appColors.primaryText,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  sections: { gap: 26, minWidth: 0 },
  section: { gap: 8, minWidth: 0 },
  sectionTitle: { fontSize: 21, fontWeight: '700' },
  gridRow: { flexDirection: 'row', gap: 6 },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appColors.border,
  },
  tile: {
    width: '31%',
    minHeight: 56,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 10,
  },
  fullTile: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tileText: { flexShrink: 1, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.55 },
  importRow: { flexDirection: 'row', gap: 8 },
  importStack: { flexDirection: 'column' },
});
