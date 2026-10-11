import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { appColors } from '../layout/appColors';
import type { RecordingStatus } from './recordingTypes';

const BAR_COUNT = 45;
/** A bounded recent history of real meter readings, never a simulated recording animation. */
export default function RecordingWaveform({
  amplitude = 0,
  durationMs,
  status,
}: {
  readonly amplitude?: number;
  readonly durationMs: number;
  readonly status: RecordingStatus;
}) {
  const [levels, setLevels] = useState(() => Array<number>(BAR_COUNT).fill(0));
  useEffect(() => {
    if (status === 'idle' || status === 'completed' || durationMs === 0) {
      setLevels(Array<number>(BAR_COUNT).fill(0));
    } else if (status === 'recording') {
      const bounded = Number.isFinite(amplitude)
        ? Math.min(1, Math.max(0, amplitude))
        : 0;
      setLevels(previous => [...previous.slice(1), bounded]);
    }
  }, [amplitude, durationMs, status]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.waveform}
      testID="recording-waveform"
    >
      {levels.map((level, index) => (
        <View
          key={index}
          testID={`recording-waveform-bar-${index}`}
          style={[
            styles.bar,
            {
              height: 3 + Math.sqrt(level) * 51,
              opacity: status === 'recording' ? 1 : 0.4,
            },
          ]}
        />
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  waveform: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  bar: { width: 3, borderRadius: 2, backgroundColor: appColors.primary },
});
