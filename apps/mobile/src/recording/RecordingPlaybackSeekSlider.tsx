import { useLayoutEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { formatRecordingDuration } from './recordingTypes';

/** One scrollable native slider; clock events remain authoritative after a gesture. */
export function RecordingPlaybackSeekSlider({
  maximum,
  position,
  seek,
}: {
  readonly maximum: number;
  readonly position: number;
  readonly seek: (positionMs: number) => void;
}) {
  const current = useRef(false);
  const dragging = useRef(false);
  const [preview, setPreview] = useState<number>();
  useLayoutEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  const clamp = (value: number) => Math.max(0, Math.min(value, maximum));
  const value = clamp(preview ?? position);
  const commit = (next: number) => {
    if (current.current && Number.isFinite(next)) seek(clamp(next));
  };

  const adjustable = {
    accessible: true,
    accessibilityRole: 'adjustable' as const,
    accessibilityLabel: t('recording.library.seekAudio'),
    accessibilityValue: {
      min: 0,
      max: maximum,
      now: value,
      text: formatRecordingDuration(value),
    },
    accessibilityActions: [{ name: 'increment' }, { name: 'decrement' }],
    onAccessibilityAction(event: { nativeEvent: { actionName: string } }) {
      const action = event.nativeEvent.actionName;
      if (action === 'increment' || action === 'decrement')
        commit(value + (action === 'increment' ? 5000 : -5000));
    },
  };
  const range = {
    style: styles.slider,
    minimumValue: 0,
    maximumValue: maximum,
    minimumTrackTintColor: appColors.primaryAction,
    tapToSeek: true,
    value,
  };

  if (Platform.OS === 'ios') {
    return (
      <View {...adjustable} testID="recording-playback-progress">
        {/* Native owns the thumb until touch ends. React gets no per-frame
            changes, and the separate adjustable element avoids double actions. */}
        <Slider
          {...range}
          accessible={false}
          accessibilityElementsHidden
          commitOnRelease
          onSlidingComplete={commit}
          testID="recording-playback-thumb"
        />
      </View>
    );
  }
  return (
    <Slider
      testID="recording-playback-progress"
      {...adjustable}
      {...range}
      onSlidingStart={() => {
        if (!current.current) return;
        dragging.current = true;
        setPreview(clamp(position));
      }}
      onValueChange={next => {
        if (!current.current || !Number.isFinite(next)) return;
        if (dragging.current) setPreview(clamp(next));
        else commit(next); // UISlider can emit a change without a touch gesture for VoiceOver.
      }}
      onSlidingComplete={next => {
        if (!current.current || !dragging.current) return;
        dragging.current = false;
        setPreview(undefined);
        commit(next);
      }}
    />
  );
}

const styles = StyleSheet.create({
  slider: { width: '100%', minHeight: 44 },
});
