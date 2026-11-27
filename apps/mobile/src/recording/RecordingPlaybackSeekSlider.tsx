import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
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

  return (
    <Slider
      testID="recording-playback-progress"
      style={styles.slider}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t('recording.library.seekAudio')}
      accessibilityValue={{
        min: 0,
        max: maximum,
        now: value,
        text: formatRecordingDuration(value),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        const action = event.nativeEvent.actionName;
        if (action === 'increment' || action === 'decrement')
          commit(value + (action === 'increment' ? 5000 : -5000));
      }}
      minimumValue={0}
      maximumValue={maximum}
      minimumTrackTintColor={appColors.primaryAction}
      tapToSeek
      value={value}
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
