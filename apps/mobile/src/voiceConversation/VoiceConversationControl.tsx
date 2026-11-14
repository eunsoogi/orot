import { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { GlassIconButton } from '../layout/GlassIconButton';
import type { VoicePhase } from './voiceTurn';

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'flex-end' },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { color: appColors.secondary },
});

/** Displays only the owner-reported voice state; pressing never starts audio by itself. */
export function VoiceConversationControl({
  phase,
  disabled,
  startLabel,
  stopLabel,
  finishLabel,
  recoverLabel,
  status,
  statusExternallyRendered = false,
  onStart,
  onStop,
  onFinish,
  onRecover,
}: {
  readonly phase: VoicePhase;
  readonly disabled: boolean;
  readonly startLabel: string;
  readonly stopLabel: string;
  readonly finishLabel: string;
  readonly recoverLabel: string;
  readonly status: string;
  readonly statusExternallyRendered?: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onFinish: () => void;
  readonly onRecover: () => void;
}) {
  useEffect(() => {
    // iOS does not implement accessibilityLiveRegion, so announce real state changes explicitly.
    if (Platform.OS === 'ios' && status)
      AccessibilityInfo.announceForAccessibility(status);
  }, [status]);
  const active = [
    'authorizing',
    'listening',
    'processing',
    'speaking',
  ].includes(phase);
  const unavailable =
    !active && phase !== 'error' && (disabled || phase === 'cleaning');
  const label =
    phase === 'error' ? recoverLabel : active ? stopLabel : startLabel;
  return (
    <View style={styles.container}>
      {status && !statusExternallyRendered ? (
        <AppText accessibilityLiveRegion="polite" style={styles.status}>
          {status}
        </AppText>
      ) : null}
      {phase === 'listening' ? (
        <GlassIconButton
          accessibilityRole="button"
          accessibilityLabel={finishLabel}
          onPress={onFinish}
          style={styles.button}
          symbolName="checkmark"
        />
      ) : null}
      <GlassIconButton
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{
          disabled: unavailable,
          busy: phase === 'cleaning',
        }}
        disabled={unavailable}
        onPress={phase === 'error' ? onRecover : active ? onStop : onStart}
        style={styles.button}
        testID="conversation-voice-control"
        symbolName={
          phase === 'error'
            ? 'arrow.clockwise'
            : active
              ? 'stop.fill'
              : 'waveform'
        }
      />
    </View>
  );
}
