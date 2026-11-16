import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Bounded local-memory presentation shared by all loading and recovery states. */
export const savedMemoryStyles = StyleSheet.create({
  section: { gap: 12, minWidth: 0 },
  entry: {
    borderRadius: 18,
    backgroundColor: appColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
  },
  panel: {
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: appColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
  },
  // Wrapping keeps shared 44pt controls and large text inside narrow layouts.
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: appColors.text },
  description: { fontSize: 14, lineHeight: 20, color: appColors.secondary },
  row: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appColors.border,
  },
  kind: { fontSize: 14, fontWeight: '600', color: appColors.secondary },
  body: { fontSize: 16, lineHeight: 24, color: appColors.text },
});
