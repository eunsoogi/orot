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
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  copy: { color: appColors.secondary, fontSize: 16, lineHeight: 22 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: appColors.surface,
  },
  consentSelected: { backgroundColor: appColors.primarySoft },
  consentCopy: { flex: 1, gap: 4 },
  // Consent and its supporting guidance stay grouped when the screen widens.
  guidancePanel: { gap: 16 },
  consentTitle: {
    color: appColors.text,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  consentCheckedText: {
    color: appColors.primaryText,
    fontSize: 14,
    lineHeight: 20,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  history: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    width: 44,
  },
  localNotice: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
  },
  localNoticeText: {
    // This is quiet local-storage context, rather than another consent or action card.
    color: appColors.secondary,
    flexShrink: 1,
    fontSize: 13,
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
