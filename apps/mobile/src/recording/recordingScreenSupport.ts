import type {
  CompletedRecording,
  RecordingService,
  RecordingSnapshot,
  RecordingSourceRecord,
} from './recordingTypes';

// The screen's normal flow and synthetic probe share the same persisted recording snapshot.
export const idle: RecordingSnapshot = {
  status: 'idle',
  id: null,
  durationMs: 0,
  consentAcknowledged: false,
};

export const completed: CompletedRecording = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  durationMs: 12_500,
  startedAt: '2026-10-04T01:00:00.000Z',
  completedAt: '2026-10-04T01:00:12.500Z',
  fileProtection: 'complete',
  excludedFromBackup: true,
};

export const savedSource: RecordingSourceRecord = {
  id: completed.id,
  sourceKind: 'audio_recording',
  effectiveAt: completed.startedAt,
  recordedAt: completed.completedAt,
  ingestedAt: '2026-10-04T02:00:00.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '상담 녹음',
};

export function createService() {
  let listener: ((snapshot: RecordingSnapshot) => void) | undefined;
  const service: RecordingService = {
    getState: jest.fn(async () => idle),
    subscribe: jest.fn((callback: (snapshot: RecordingSnapshot) => void) => {
      listener = callback;
      return jest.fn();
    }),
    start: jest.fn(async () => ({
      ...idle,
      status: 'recording' as const,
      id: completed.id,
      consentAcknowledged: true,
    })),
    pause: jest.fn(async () => ({
      ...idle,
      status: 'paused' as const,
      id: completed.id,
    })),
    resume: jest.fn(async () => ({
      ...idle,
      status: 'recording' as const,
      id: completed.id,
      consentAcknowledged: true,
    })),
    stop: jest.fn(async () => completed),
    playRange: jest.fn(
      async (_recordingId: string, startMs: number, endMs: number) => ({
        startMs,
        endMs,
        actualStartMs: startMs,
      }),
    ),
    saveSource: jest.fn(async () => savedSource),
  };
  return {
    service,
    emit: (snapshot: RecordingSnapshot) => listener?.(snapshot),
  };
}
