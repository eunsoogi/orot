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
          <AppSymbol
            name={muted ? 'mic.slash' : direction ? 'waveform' : 'ellipsis'}
            size={amplitude > 0 ? 20 + Math.round(amplitude * 14) : 20}
            color={appColors.primary}
          />
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: {
    minWidth: 56,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
