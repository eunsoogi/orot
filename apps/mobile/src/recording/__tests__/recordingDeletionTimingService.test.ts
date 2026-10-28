import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import type { SourceRecord } from '@orot/domain';
import {
  createRecordingLibraryService,
  type RecordingAudioDeletion,
} from '../recordingLibraryService';
import {
  withRecordingDeletionTiming,
  type RecordingDeletionTimingProbe,
} from '../recordingDeletionTiming';
import { RecordingDeletionTimingProbe as TimingProbe } from '../recordingDeletionTimingProbe';

const source: SourceRecord = {
  id: 'recording-1',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '상담 녹음',
};

test('measures ordered service stages without changing deletion recovery', async () => {
  const now = { value: 100 };
  const order: string[] = [];
  const records = {
    get: jest.fn(async () => {
      now.value += 2;
      return source;
    }),
  } as unknown as RecordRepository;
  const audio: RecordingAudioDeletion = {
    reconcile: jest.fn(async () => {}),
    stage: jest.fn(async () => {
      order.push('stage');
      now.value += 5;
    }),
    restore: jest.fn(async () => {}),
    commit: jest.fn(async () => {
      order.push('commit');
      now.value += 6;
    }),
  };
  const memory = {} as AgentMemoryService;
  const probe = new TimingProbe(() => now.value);
  probe.mark('confirmation-tap');
  now.value += 1;
  probe.mark('progress-presented');
  const service = createRecordingLibraryService({
    loadRepository: async () => {
      now.value += 1;
      return records;
    },
    openMemory: async () => {
      now.value += 7;
      return memory;
    },
    audioDeletion: audio,
    assertRecordingStopped: async () => {
      order.push('idle');
      now.value += 3;
    },
    removeSource: async (
      _id: string,
      _memory: AgentMemoryService,
      timingProbe: RecordingDeletionTimingProbe | undefined,
    ) => {
      order.push('source');
      await withRecordingDeletionTiming(
        timingProbe,
        'derived-data-cleanup',
        async () => {
          now.value += 4;
        },
      );
      await withRecordingDeletionTiming(
        timingProbe,
        'database-delete-commit',
        async () => {
          now.value += 8;
          return true;
        },
      );
      return { sourceDeleted: true, memoriesDeleted: 1 };
    },
  });

  await expect(service.deleteRecording(source.id, probe)).resolves.toEqual({
    audioCleanupPending: false,
  });
  now.value += 2;
  probe.mark('list-refresh');

  const report = probe.snapshot();
  expect(report.complete).toBe(true);
  expect(report.durationsMs).toMatchObject({
    confirmationToProgress: 1,
    sourceRead: 3,
    stopCheck: 3,
    audioStaging: 5,
    memoryOpen: 7,
    derivedDataCleanup: 4,
    databaseDeleteCommit: 8,
    audioCleanup: 6,
    audioCleanupToListRefresh: 2,
    confirmationToListRefresh: 39,
  });
  expect(order).toEqual(['idle', 'stage', 'source', 'commit']);
});

test('records a failed database commit and staged-audio restoration', async () => {
  const now = { value: 200 };
  const failure = new Error('Database delete failed.');
  const order: string[] = [];
  const records = {
    get: jest.fn(async () => {
      now.value += 2;
      return source;
    }),
  } as unknown as RecordRepository;
  const audio: RecordingAudioDeletion = {
    reconcile: jest.fn(async () => {}),
    stage: jest.fn(async () => {
      order.push('stage');
      now.value += 3;
    }),
    restore: jest.fn(async () => {
      order.push('restore');
      now.value += 5;
    }),
    commit: jest.fn(async () => {
      order.push('commit');
    }),
  };
  const probe = new TimingProbe(() => now.value);
  probe.mark('confirmation-tap');
  now.value += 1;
  probe.mark('progress-presented');
  const service = createRecordingLibraryService({
    loadRepository: async () => {
      now.value += 1;
      return records;
    },
    openMemory: async () => {
      now.value += 4;
      return {} as AgentMemoryService;
    },
    audioDeletion: audio,
    assertRecordingStopped: async () => {
      now.value += 2;
    },
    removeSource: async (
      _id: string,
      _memory: AgentMemoryService,
      timingProbe: RecordingDeletionTimingProbe | undefined,
    ) => {
      // Keep the failed commit after derived cleanup to verify their spans stay distinct.
      await withRecordingDeletionTiming(
        timingProbe,
        'derived-data-cleanup',
        async () => {
          now.value += 6;
        },
      );
      await withRecordingDeletionTiming(
        timingProbe,
        'database-delete-commit',
        async () => {
          now.value += 7;
          throw failure;
        },
      );
      return { sourceDeleted: false, memoriesDeleted: 0 };
    },
  });

  await expect(service.deleteRecording(source.id, probe)).rejects.toBe(failure);
  now.value += 2;
  probe.mark('list-refresh');

  const report = probe.snapshot();
  expect(report).toMatchObject({ complete: true, succeeded: false });
  expect(report.durationsMs).toMatchObject({
    databaseDeleteCommit: 7,
    audioCleanup: 5,
    confirmationToListRefresh: 33,
  });
  expect(
    report.events.filter(
      event =>
        event.stage === 'database-delete-commit' && event.phase === 'end',
    ),
  ).toEqual([
    {
      stage: 'database-delete-commit',
      phase: 'end',
      elapsedMs: 26,
      outcome: 'failure',
    },
  ]);
  expect(order).toEqual(['stage', 'restore']);
  expect(audio.restore).toHaveBeenCalledTimes(1);
  expect(audio.commit).not.toHaveBeenCalled();
  expect(JSON.stringify(report)).not.toContain(source.id);
});
