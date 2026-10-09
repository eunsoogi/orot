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
  reconcileRecordingDeletions?(sourceIds: readonly string[]): Promise<void>;
  stageRecordingDeletion?(recordingId: string): Promise<void>;
  restoreRecordingDeletion?(recordingId: string): Promise<void>;
  commitRecordingDeletion?(recordingId: string): Promise<void>;
  prepareSyntheticCapture?: () => Promise<boolean>;
  prepareSyntheticStartFailure?: (
    point: 'beforeFileURL' | 'afterFileCreated',
  ) => Promise<void>;
  simulateInterruption?: (phase: 'began' | 'ended') => Promise<void>;
  shareRecordingAudio?: (recordingId: string) => Promise<RecordingExportResult>;
  shareRecordingTranscript?: (text: string) => Promise<RecordingExportResult>;
  prepareSyntheticExportResidue?: () => Promise<number>;
  getSyntheticExportResidueCount?: () => Promise<number>;
  armSyntheticExportCancellation?: () => Promise<boolean>;
}

export type RecordingExportResult = 'completed' | 'cancelled';

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

type RecordingDeletionMethod =
  | 'reconcileRecordingDeletions'
  | 'stageRecordingDeletion'
  | 'restoreRecordingDeletion'
  | 'commitRecordingDeletion';

function deletionMethod<Method extends RecordingDeletionMethod>(
  method: Method,
): NonNullable<NativeRecordingModule[Method]> {
  // Missing native methods fail clearly; deletion must not appear to succeed.
  const module = requireNativeModule();
  const operation = module[method];
  if (!operation)
    throw new Error('Recording deletion is unavailable in this build.');
  return operation.bind(module) as NonNullable<NativeRecordingModule[Method]>;
}

export async function reconcileRecordingDeletions(
  sourceIds: readonly string[],
): Promise<void> {
  await deletionMethod('reconcileRecordingDeletions')([...sourceIds]);
}

export async function stageRecordingDeletion(
  recordingId: string,
): Promise<void> {
  await deletionMethod('stageRecordingDeletion')(recordingId);
}

export async function restoreRecordingDeletion(
  recordingId: string,
): Promise<void> {
  await deletionMethod('restoreRecordingDeletion')(recordingId);
}

export async function commitRecordingDeletion(
  recordingId: string,
): Promise<void> {
  await deletionMethod('commitRecordingDeletion')(recordingId);
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

export async function shareRecordingAudio(
  recordingId: string,
): Promise<RecordingExportResult> {
  const share = requireNativeModule().shareRecordingAudio;
  if (!share) {
    throw new Error('Recording audio export is unavailable on this platform.');
  }
  return share(recordingId);
}

export async function shareRecordingTranscript(
  text: string,
): Promise<RecordingExportResult> {
  const share = requireNativeModule().shareRecordingTranscript;
  if (!share) {
    throw new Error(
      'Recording transcript export is unavailable on this platform.',
    );
  }
  return share(text);
}

export async function prepareSyntheticExportResidue(): Promise<number> {
  const prepare = requireNativeModule().prepareSyntheticExportResidue;
  if (!prepare) {
    throw new Error('Synthetic export residue is unavailable in this build.');
  }
  return prepare();
}

export async function getSyntheticExportResidueCount(): Promise<number> {
  const getCount = requireNativeModule().getSyntheticExportResidueCount;
  if (!getCount) {
    throw new Error('Synthetic export residue is unavailable in this build.');
  }
  return getCount();
}

export async function armSyntheticExportCancellation(): Promise<void> {
  const arm = requireNativeModule().armSyntheticExportCancellation;
  if (!arm || !(await arm())) {
    throw new Error('The export cancellation probe could not be armed.');
  }
}
