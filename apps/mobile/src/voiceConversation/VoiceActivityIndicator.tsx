import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { ConversationActivityBubble } from '../ragConversation/ConversationActivityBubble';
import {
  subscribeNativeVoiceAudioLevel,
  type SubscribeVoiceAudioLevel,
} from './nativeVoiceAudioLevel';
import type { VoicePhase } from './voiceTurn';

const levelExpiryMs = 240;
const minimumUpdateMs = 65;
const audibleFloor = 0.025;
const waveformWeights = [0.4, 0.7, 1, 0.8, 0.45] as const;

/** Keep quiet PCM levels visible without synthesizing motion from silence. */
function VoiceWaveform({ amplitude }: { amplitude: number }) {
  const strength = Math.min(1, Math.sqrt(amplitude) * 2.4);
  return (
    <View
      testID="voice-activity-waveform"
      // Grow within the existing frame, not the surrounding screen layout.
      style={[
        styles.waveform,
        amplitude > 0 && { transform: [{ scale: 1.25 + strength * 0.15 }] },
      ]}
    >
      {waveformWeights.map(weight => (
        <View
          key={weight}
          testID="voice-activity-waveform-bar"
          style={[styles.bar, { height: 4 + weight * (8 + strength * 14) }]}
        />
      ))}
    </View>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live = true;
    let changed = false;
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => {
        changed = true;
        if (live) setReduced(value);
      },
    );
    AccessibilityInfo.isReduceMotionEnabled().then(
      value => {
        if (live && !changed) setReduced(value);
      },
      () => undefined,
    );
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Suppress timed fake waveforms. The only motion comes from this call's live PCM envelope. */
export function VoiceActivityIndicator({
  visible,
  phase,
  callId,
  subscribe = subscribeNativeVoiceAudioLevel,
}: {
  visible: boolean;
  phase: VoicePhase;
  callId?: string;
  subscribe?: SubscribeVoiceAudioLevel;
}) {
  const reduced = useReducedMotion();
  const direction =
    phase === 'listening'
      ? 'input'
      : phase === 'speaking'
        ? 'output'
        : undefined;
  const active = visible && direction !== undefined && !!callId;
  const [meter, setMeter] = useState<{
    callId: string;
    direction: string;
    amplitude: number;
  }>();
  useEffect(() => {
    if (!active || reduced || !callId || !direction) return;
    let live = true;
    let previous = 0;
    let last = -Infinity;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      previous = 0;
      if (live) setMeter(undefined);
    };
    const stop = subscribe(sample => {
      if (!live || sample.callId !== callId || sample.direction !== direction)
        return;
      if (sample.level < audibleFloor) {
        clearTimeout(expiry);
        reset();
        return;
      }
      const now = Date.now();
      if (now - last < minimumUpdateMs && now >= last) return;
      last = now;
      previous = previous
        ? previous * 0.35 + sample.level * 0.65
        : sample.level;
      setMeter({ callId, direction, amplitude: previous });
      clearTimeout(expiry);
      expiry = setTimeout(reset, levelExpiryMs);
    });
    return () => {
      live = false;
      clearTimeout(expiry);
      stop?.();
      setMeter(undefined);
    };
  }, [active, callId, direction, reduced, subscribe]);
  const amplitude =
    active &&
    !reduced &&
    meter &&
    meter.callId === callId &&
    meter.direction === direction
      ? meter.amplitude
      : 0;
  const muted = phase === 'stopped' || phase === 'ended';
  return (
    <View
      style={styles.frame}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {visible && phase === 'authorizing' ? (
        <ConversationActivityBubble />
      ) : (
        <View testID="voice-activity-symbol">
          {direction ? (
            <VoiceWaveform amplitude={amplitude} />
          ) : (
            <AppSymbol
              name={muted ? 'mic.slash' : 'ellipsis'}
              size={20}
              color={appColors.primary}
            />
          )}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  waveform: {
    width: 32,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: appColors.primary,
  },
  frame: {
    minWidth: 56,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
