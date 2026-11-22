import {
  roundPrimaryActionDiameter,
  roundPrimaryActionStyles,
} from '../layout/roundPrimaryActionStyles';
import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Session status stays separate from consent guidance while preserving the current microphone and Glass controls. */
export const recordingSessionStyles = StyleSheet.create({
  panel: { gap: 16 },
  compactSession: { gap: 4, paddingTop: 0, paddingBottom: 0 },
  compactDuration: { fontSize: 32, lineHeight: 40 },
  compactMicrophone: { width: 88, height: 88 },
  compactMicrophoneInner: { width: 76, height: 76 },
  compactSecondaryAction: { width: 48, height: 48 },
  session: { alignItems: 'center', gap: 16, paddingTop: 24, paddingBottom: 12 },
  microphone: {
    ...roundPrimaryActionStyles.outer,
    width: roundPrimaryActionDiameter,
    height: roundPrimaryActionDiameter,
    borderRadius: roundPrimaryActionDiameter / 2,
    padding: 10,
  },
  microphoneInner: {
    ...roundPrimaryActionStyles.inner,
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  secondaryAction: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 64,
    height: 64,
    borderRadius: 36,
    overflow: 'hidden',
  },
  status: {
    fontSize: 18,
    fontWeight: '600',
    color: appColors.secondary,
    textAlign: 'center',
  },
  duration: {
    alignSelf: 'stretch',
    fontSize: 52,
    lineHeight: 68,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: appColors.text,
    textAlign: 'center',
  },
  actions: {
    alignItems: 'center',
    width: '100%',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});
