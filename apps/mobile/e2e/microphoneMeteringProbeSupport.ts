import { NativeEventEmitter, NativeModules } from 'react-native';
import type { RecordingStatus } from '../src/recording/recordingTypes';

export interface MeteringState {
  status: RecordingStatus | 'permission';
  reason: string;
  durationMs: number;
  amplitude: number;
  ticks: number;
  cleanupComplete: boolean;
  fileProtection: string;
  excludedFromBackup: boolean;
  unlinked: boolean;
}
interface ProbeModule {
  start(consent: boolean): Promise<MeteringState>;
  pause(): Promise<MeteringState>;
  resume(): Promise<MeteringState>;
  finish(): Promise<MeteringState>;
  getState(): Promise<MeteringState>;
  addListener(event: string): void;
  removeListeners(count: number): void;
}

/** No fallback exists: ordinary builds must report the compile-gated module unavailable. */
export function meteringProbeModule(): ProbeModule {
  const module = NativeModules.RecordingMeteringProbeModule as
    ProbeModule | undefined;
  if (!module) throw new Error('METERING_UNAVAILABLE');
  return module;
}
export function subscribeMetering(listener: (state: MeteringState) => void) {
  const subscription = new NativeEventEmitter(
    meteringProbeModule(),
  ).addListener('RecordingMeteringProbeChanged', value =>
    listener(value as unknown as MeteringState),
  );
  return () => subscription.remove();
}

export interface MeterStats {
  samples: number;
  min: number | null;
  max: number | null;
  nonzero: number;
}
export function emptyMeterStats(): MeterStats {
  return { samples: 0, min: null, max: null, nonzero: 0 };
}

/** Statistics describe only native events; silence is valid and never replaced by generated levels. */
export function addMeterSample(
  stats: MeterStats,
  amplitude: number,
): MeterStats {
  return {
    samples: stats.samples + 1,
    min: stats.min === null ? amplitude : Math.min(stats.min, amplitude),
    max: stats.max === null ? amplitude : Math.max(stats.max, amplitude),
    nonzero: stats.nonzero + (amplitude > 0 ? 1 : 0),
  };
}
