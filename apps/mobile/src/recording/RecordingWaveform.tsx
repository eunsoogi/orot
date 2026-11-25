import { useEffect, useState } from 'react';
import { AudioLevelWaveform } from '../ui/AudioLevelWaveform';
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
    <AudioLevelWaveform
      active={status === 'recording'}
      levels={levels}
      testID="recording-waveform"
    />
  );
}
