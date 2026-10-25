import { NativeEventEmitter } from 'react-native';
import type {
  CompletedRecording,
  RecordingPlaybackService,
  RecordingPlaybackRange,
  RecordingPlaybackState,
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

export interface RecordingBridge extends RecordingPlaybackService {
  readDuration(recordingId: string): Promise<number>;
  stopPlayback(): Promise<void>;
  subscribePlayback(
    listener: (state: RecordingPlaybackState) => void,
  ): () => void;
  getState(): Promise<RecordingSnapshot>;
  subscribe(listener: (snapshot: RecordingSnapshot) => void): () => void;
  start(consentAcknowledged: boolean): Promise<RecordingSnapshot>;
  pause(): Promise<RecordingSnapshot>;
  resume(): Promise<RecordingSnapshot>;
  stop(): Promise<CompletedRecording>;
}

export const nativeRecordingBridge: RecordingBridge = {
  readDuration(recordingId) {
    const module = requireNativeModule();
    if (!module.getRecordingDuration)
      throw new Error('Saved audio metadata is unavailable.');
    return module.getRecordingDuration(recordingId, false);
  },
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
  subscribePlayback(listener: (state: RecordingPlaybackState) => void) {
    // Progress events are optional in non-native renders; playback actions still report a missing native module.
    const module = getNativeRecordingModule();
    if (!module) return () => {};
    const subscription = new NativeEventEmitter(module).addListener(
      'RecordingPlaybackStateChanged',
      value => listener(value as unknown as RecordingPlaybackState),
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
  stopPlayback() {
    const module = requireNativeModule();
    if (!module.stopRecordingPlayback) {
      throw new Error(
        'Native recording playback cannot be stopped in this build.',
      );
    }
    return module.stopRecordingPlayback();
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

/** Only the dedicated Simulator build tolerates unavailable protection metadata for disposable fixture audio. */
export async function readSyntheticRecordingDuration(
  recordingId: string,
): Promise<number> {
  const module = requireNativeModule();
  if (!module.getRecordingDuration)
    throw new Error('Saved audio metadata is unavailable.');
  return module.getRecordingDuration(recordingId, true);
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

export async function simulateSyntheticPlaybackRouteLoss(): Promise<void> {
  const module = requireNativeModule();
  if (!module.simulatePlaybackRouteLoss) {
    throw new Error(
      'Synthetic playback route changes are unavailable in this build.',
    );
  }
  return module.simulatePlaybackRouteLoss();
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
