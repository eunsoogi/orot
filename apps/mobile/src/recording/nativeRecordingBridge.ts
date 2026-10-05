import { NativeEventEmitter, NativeModules } from 'react-native';
import type {
  CompletedRecording,
  RecordingPlaybackRange,
  RecordingSnapshot,
} from './recordingTypes';

interface SyntheticTranscriptionRecording {
  readonly id: string;
  readonly durationMs: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly fileProtection: 'complete' | 'unverified' | 'unknown';
  readonly excludedFromBackup: boolean;
}

interface NativeRecordingModule {
  addListener(eventType: string): void;
  removeListeners(count: number): void;
  getState(): Promise<RecordingSnapshot>;
  startRecording(consentAcknowledged: boolean): Promise<RecordingSnapshot>;
  pauseRecording(): Promise<RecordingSnapshot>;
  resumeRecording(): Promise<RecordingSnapshot>;
  stopRecording(): Promise<CompletedRecording>;
  playRecordingRange?(
    recordingId: string,
    startMs: number,
    endMs: number,
    syntheticFixture: boolean,
  ): Promise<RecordingPlaybackRange>;
  installSyntheticTranscriptionFixture?: (
    audioBase64: string,
  ) => Promise<SyntheticTranscriptionRecording>;
  removeSyntheticTranscriptionFixture?: (
    recordingId: string,
  ) => Promise<boolean>;
  prepareSyntheticCapture?: () => Promise<boolean>;
  prepareSyntheticStartFailure?: (
    point: 'beforeFileURL' | 'afterFileCreated',
  ) => Promise<void>;
  simulateInterruption?: (phase: 'began' | 'ended') => Promise<void>;
}

export interface RecordingBridge {
  getState(): Promise<RecordingSnapshot>;
  subscribe(listener: (snapshot: RecordingSnapshot) => void): () => void;
  start(consentAcknowledged: boolean): Promise<RecordingSnapshot>;
  pause(): Promise<RecordingSnapshot>;
  resume(): Promise<RecordingSnapshot>;
  stop(): Promise<CompletedRecording>;
  playRange(
    recordingId: string,
    startMs: number,
    endMs: number,
  ): Promise<RecordingPlaybackRange>;
}

function requireNativeModule(): NativeRecordingModule {
  const module = NativeModules.RecordingModule as
    NativeRecordingModule | undefined;
  if (!module) {
    const error = new Error(
      'The iOS recording module is unavailable.',
    ) as Error & {
      code?: string;
    };
    error.code = 'RECORDING_UNAVAILABLE';
    throw error;
  }
  return module;
}

export const nativeRecordingBridge: RecordingBridge = {
  getState() {
    return requireNativeModule().getState();
  },
  subscribe(listener) {
    const module = requireNativeModule();
    const subscription = new NativeEventEmitter(module).addListener(
      'RecordingStateChanged',
      value => listener(value as unknown as RecordingSnapshot),
    );
    return () => subscription.remove();
  },
  start(consentAcknowledged) {
    return requireNativeModule().startRecording(consentAcknowledged);
  },
  pause() {
    return requireNativeModule().pauseRecording();
  },
  resume() {
    return requireNativeModule().resumeRecording();
  },
  stop() {
    return requireNativeModule().stopRecording();
  },
  playRange(recordingId, startMs, endMs) {
    const module = requireNativeModule();
    if (!module.playRecordingRange) {
      throw new Error('The native recording playback method is unavailable.');
    }
    return module.playRecordingRange(recordingId, startMs, endMs, false);
  },
};

export async function installSyntheticTranscriptionRecording(
  audioBase64: string,
): Promise<SyntheticTranscriptionRecording> {
  const module = requireNativeModule();
  if (!module.installSyntheticTranscriptionFixture) {
    throw new Error(
      'Synthetic transcription fixtures require the dedicated Simulator build.',
    );
  }
  return module.installSyntheticTranscriptionFixture(audioBase64);
}

export async function removeSyntheticTranscriptionRecording(
  recordingId: string,
): Promise<void> {
  const remove = requireNativeModule().removeSyntheticTranscriptionFixture;
  if (!remove) {
    throw new Error(
      'Synthetic transcription fixture cleanup requires the dedicated Simulator build.',
    );
  }
  await remove(recordingId);
}

export async function playSyntheticTranscriptionRange(
  recordingId: string,
  startMs: number,
  endMs: number,
): Promise<RecordingPlaybackRange> {
  const module = requireNativeModule();
  if (!module.playRecordingRange) {
    throw new Error('The native recording playback method is unavailable.');
  }
  return module.playRecordingRange(recordingId, startMs, endMs, true);
}

export function isSyntheticRecordingProbeAvailable(): boolean {
  const module = NativeModules.RecordingModule as
    NativeRecordingModule | undefined;
  return (
    __DEV__ &&
    module?.prepareSyntheticCapture !== undefined &&
    module.prepareSyntheticStartFailure !== undefined &&
    module.simulateInterruption !== undefined
  );
}

export async function prepareSyntheticRecordingStartFailure(
  point: 'beforeFileURL' | 'afterFileCreated',
): Promise<void> {
  const module = requireNativeModule();
  if (!__DEV__ || !module.prepareSyntheticStartFailure) {
    throw new Error(
      'Recording start failures can be simulated only in an iOS Simulator debug build.',
    );
  }
  await module.prepareSyntheticStartFailure(point);
}

export async function prepareSyntheticRecordingProbe(): Promise<void> {
  const module = requireNativeModule();
  if (!__DEV__ || !module.prepareSyntheticCapture) {
    throw new Error(
      'Synthetic recording is available only in an iOS Simulator debug build.',
    );
  }
  if (!(await module.prepareSyntheticCapture())) {
    throw new Error('The synthetic recording fixture could not be prepared.');
  }
}

export async function simulateRecordingInterruption(
  phase: 'began' | 'ended',
): Promise<void> {
  const module = requireNativeModule();
  if (!__DEV__ || !module.simulateInterruption) {
    throw new Error('Interruption simulation is unavailable in this build.');
  }
  await module.simulateInterruption(phase);
}
