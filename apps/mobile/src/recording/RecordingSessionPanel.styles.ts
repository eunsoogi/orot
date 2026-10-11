import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** The recording mock's central microphone, clock and full-width wave share one visual axis. */
export const recordingSessionStyles = StyleSheet.create({
  session: { alignItems: 'center', gap: 16, paddingTop: 32, paddingBottom: 12 },
  microphone: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
  },
  status: {
    fontSize: 18,
    fontWeight: '600',
    color: appColors.primaryText,
    textAlign: 'center',
  },
  duration: {
    fontSize: 56,
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
  actions: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  action: { flex: 1 },
});
