import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { ConversationActivityBubble } from '../ragConversation/ConversationActivityBubble';
import { AudioLevelWaveform } from '../ui/AudioLevelWaveform';
import {
  subscribeNativeVoiceAudioLevel,
  type SubscribeVoiceAudioLevel,
} from './nativeVoiceAudioLevel';
import type { VoicePhase } from './voiceTurn';

const levelExpiryMs = 240;
const minimumUpdateMs = 65;
const audibleFloor = 0.025;
// Match the recording waveform's fine bars with more recent speech detail
// without changing native sampling or how quickly silence clears the display.
const liveBarCount = 19;
const liveWaveformWidth = 111;
const liveWaveformHeight = 48;
const silence = Array<number>(liveBarCount).fill(0);

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
    levels: readonly number[];
  }>();
  useEffect(() => {
    if (!active || reduced || !callId || !direction) return;
    let live = true;
    let previous = 0;
    let levels: readonly number[] = silence;
    let last = -Infinity;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      previous = 0;
      levels = silence;
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
      levels = [...levels.slice(1), previous];
      setMeter({ callId, direction, levels });
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
  const levels =
    active &&
    !reduced &&
    meter &&
    meter.callId === callId &&
    meter.direction === direction
      ? meter.levels
      : silence;
  const muted = phase === 'stopped' || phase === 'ended';
  return (
    <View
      style={styles.frame}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {visible && phase === 'authorizing' ? (
        <ConversationActivityBubble centered />
      ) : (
        <View testID="voice-activity-symbol">
          {direction ? (
            <AudioLevelWaveform
              active
              levels={levels}
              maxBarHeight={liveWaveformHeight}
              style={styles.waveform}
              testID="voice-activity-waveform"
            />
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
  waveform: { width: liveWaveformWidth, height: liveWaveformHeight },
  frame: {
    minWidth: liveWaveformWidth,
    minHeight: liveWaveformHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
