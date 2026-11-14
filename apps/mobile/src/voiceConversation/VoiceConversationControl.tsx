import { useEffect } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ComposerGlassBackground } from '../ragConversation/ComposerGlassBackground';
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={finishLabel}
          onPress={onFinish}
          style={styles.button}
        >
          <ComposerGlassBackground />
          <AppSymbol name="checkmark" color={appColors.text} />
        </Pressable>
      ) : null}
      <Pressable
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
      >
        <ComposerGlassBackground testID="voice-control-glass" />
        <AppSymbol
          name={
            phase === 'error'
              ? 'arrow.clockwise'
              : active
                ? 'stop.fill'
                : 'waveform'
          }
          // Dim only the glyph; UIVisualEffectView and its ancestors must keep alpha 1.
          color={unavailable ? appColors.secondary : appColors.text}
        />
      </Pressable>
    </View>
  );
}
