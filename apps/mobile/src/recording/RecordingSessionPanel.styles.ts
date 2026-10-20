import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Session actions follow the generated microphone-and-icon mockup while keeping large touch targets. */
export const recordingSessionStyles = StyleSheet.create({
  heading: { textAlign: 'center' },
  compactMicrophone: { width: 128, height: 128 },
  compactMicrophoneInner: { width: 112, height: 112 },
  compactSecondaryAction: { width: 48, height: 48 },
  session: { alignItems: 'center', gap: 16, paddingTop: 24, paddingBottom: 12 },
  microphone: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 160,
    height: 160,
    borderRadius: 80,
    padding: 10,
    backgroundColor: appColors.primarySoft,
  },
  microphoneInner: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: appColors.primaryAction,
  },
  secondaryAction: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 64,
    height: 64,
    borderRadius: 36,
    borderColor: appColors.border,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: appColors.surface,
  },
  status: {
    fontSize: 18,
    fontWeight: '600',
    color: appColors.primaryText,
    textAlign: 'center',
  },
  duration: {
    fontSize: 52,
    lineHeight: 68,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: appColors.text,
    textAlign: 'center',
  },
  hint: {
    color: appColors.secondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  actions: {
    alignItems: 'center',
    width: '100%',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});
