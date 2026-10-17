import type { RecordMap } from '@orot/storage';

export type RecordingSourceRecord = RecordMap['source_record'];

export type RecordingStatus =
  'idle' | 'recording' | 'paused' | 'interrupted' | 'completed';

export interface RecordingSnapshot {
  status: RecordingStatus;
  id: string | null;
  durationMs: number;
  /** Linear microphone amplitude in [0, 1]; absent on older bridges and zero while paused. */
  amplitude?: number;
  consentAcknowledged: boolean;
}

export interface CompletedRecording {
  id: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  fileProtection: 'complete' | 'unverified' | 'unknown';
  excludedFromBackup: boolean;
}

export interface RecordingPlaybackRange {
  readonly startMs: number;
  readonly endMs: number;
  readonly actualStartMs: number;
  /** Native terminal reason and player clock, captured before the player is released. */
  readonly completion?: 'completed' | 'stopped';
  readonly actualEndMs?: number;
}

/** Current native player state; positions and durations are milliseconds. */
export interface RecordingPlaybackState {
  readonly status: 'idle' | 'playing';
  readonly recordingId: string | null;
  readonly positionMs: number;
  readonly durationMs: number;
}

/** Keeps playback controls independent from capture while exposing optional native events and stop. */
export interface RecordingPlaybackService {
  playRange(
    recordingId: string,
    startMs: number,
    endMs: number,
  ): Promise<RecordingPlaybackRange>;
  stopPlayback?(): Promise<void>;
  subscribePlayback?(
    listener: (state: RecordingPlaybackState) => void,
  ): () => void;
}

export interface RecordingService extends RecordingPlaybackService {
  getState(): Promise<RecordingSnapshot>;
  subscribe(listener: (snapshot: RecordingSnapshot) => void): () => void;
  start(consentAcknowledged: boolean): Promise<RecordingSnapshot>;
  pause(): Promise<RecordingSnapshot>;
  resume(): Promise<RecordingSnapshot>;
  stop(): Promise<CompletedRecording>;
  saveSource(recording: CompletedRecording): Promise<RecordingSourceRecord>;
}

export function formatRecordingDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [minutes, seconds].map(value => String(value).padStart(2, '0'));
  return hours > 0
    ? `${hours}:${clock[0]}:${clock[1]}`
    : `${clock[0]}:${clock[1]}`;
}
