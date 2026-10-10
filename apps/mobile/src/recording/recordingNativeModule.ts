import { NativeModules } from 'react-native';
import type {
  CompletedRecording,
  RecordingPlaybackRange,
  RecordingSnapshot,
} from './recordingTypes';

export type RecordingExportResult = 'completed' | 'cancelled';

export interface SyntheticTranscriptionRecording {
  readonly id: string;
  readonly durationMs: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly fileProtection: 'complete' | 'unverified' | 'unknown';
  readonly excludedFromBackup: boolean;
}

/** Keeps the optional native methods shared by capture, deletion, and export bridges in one contract. */
export interface NativeRecordingModule {
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

export function getNativeRecordingModule(): NativeRecordingModule | undefined {
  return NativeModules.RecordingModule as NativeRecordingModule | undefined;
}

export function requireNativeModule(): NativeRecordingModule {
  const module = getNativeRecordingModule();
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
