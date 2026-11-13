import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import type { VoicePhase } from './voiceTurn';

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'flex-end' },
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { color: appColors.secondary },
  disabled: { opacity: 0.5 },
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
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onFinish: () => void;
  readonly onRecover: () => void;
}) {
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
      {status ? (
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
        style={[styles.button, unavailable && styles.disabled]}
        testID="conversation-voice-control"
      >
        <AppSymbol
          name={
            phase === 'error'
              ? 'arrow.clockwise'
              : active
                ? 'stop.fill'
                : 'waveform'
          }
          color={appColors.text}
        />
      </Pressable>
    </View>
  );
}
