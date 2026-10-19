import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const recordingControlStyles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
    flexGrow: 1,
    // Route content starts below the safe area; only individual controls center their contents.
    justifyContent: 'flex-start',
    gap: 16,
    padding: 24,
    backgroundColor: appColors.background,
  },
  back: { alignSelf: 'flex-start' },
  title: { color: appColors.text, fontSize: 32, fontWeight: '700' },
  copy: { color: appColors.secondary, fontSize: 16, lineHeight: 22 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: appColors.primarySoft,
  },
  consentIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    width: 44,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    paddingRight: 10,
  },
  localNotice: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  localNoticeText: {
    color: appColors.text,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  recordingStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  status: { color: appColors.text, fontSize: 18, fontWeight: '700' },
  liveStatus: { color: appColors.danger },
  liveDot: {
    backgroundColor: appColors.danger,
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  duration: { color: appColors.secondary, fontSize: 16 },
  result: { gap: 8 },
  error: { color: appColors.danger, fontSize: 15 },
  probe: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
});
