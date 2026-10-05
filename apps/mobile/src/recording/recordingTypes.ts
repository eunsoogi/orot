import type { RecordMap } from '@orot/storage';

export type RecordingSourceRecord = RecordMap['source_record'];

export type RecordingStatus =
  'idle' | 'recording' | 'paused' | 'interrupted' | 'completed';

export interface RecordingSnapshot {
  status: RecordingStatus;
  id: string | null;
  durationMs: number;
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

export interface RecordingService {
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
