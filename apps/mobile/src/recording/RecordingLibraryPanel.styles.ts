import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const recordingLibraryStyles = StyleSheet.create({
  container: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appColors.border,
    paddingTop: 12,
  },
  title: { color: appColors.text, fontSize: 18, fontWeight: '700' },
  copy: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  list: { gap: 8 },
  item: {
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    paddingTop: 10,
  },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  detail: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    paddingTop: 12,
  },
  confirmation: {
    gap: 8,
    borderWidth: 1,
    borderColor: appColors.danger,
    borderRadius: 8,
    backgroundColor: appColors.surface,
    padding: 12,
  },
  confirmationActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  confirmationAction: {
    minHeight: 44,
    minWidth: 72,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  confirmationActionDisabled: { opacity: 0.5 },
  confirmationCancel: { backgroundColor: appColors.background },
  confirmationConfirm: { backgroundColor: appColors.dangerAction },
  confirmationCancelText: { color: appColors.text, fontWeight: '600' },
  confirmationConfirmText: { color: appColors.onDanger, fontWeight: '600' },
  confirmationBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  confirmationTitle: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  error: { color: appColors.danger, fontSize: 14 },
});
