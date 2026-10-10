import { NativeEventEmitter } from 'react-native';
import type {
  CompletedRecording,
  RecordingPlaybackRange,
  RecordingSnapshot,
} from './recordingTypes';
import {
  getNativeRecordingModule,
  requireNativeModule,
  type NativeRecordingModule,
  type SyntheticTranscriptionRecording,
} from './recordingNativeModule';

export type { RecordingExportResult } from './recordingNativeModule';
export {
  armSyntheticExportCancellation,
  getSyntheticExportResidueCount,
  prepareSyntheticExportResidue,
  shareRecordingAudio,
  shareRecordingTranscript,
} from './recordingExportNativeBridge';

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
  const module = getNativeRecordingModule();
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
