import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import type { SourceRecord } from '@orot/domain';
import {
  createRecordingLibraryService,
  type RecordingAudioDeletion,
} from '../recordingLibraryService';

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

const olderSource: SourceRecord = {
  ...source,
  id: '123e4567-e89b-12d3-a456-426614174001',
  recordedAt: '2026-10-04T10:00:05.000Z',
  title: '이전 상담 녹음',
};

function repository(record: SourceRecord | null = source): RecordRepository {
  return {
    get: jest.fn(async () => record),
    list: jest.fn(async () => [
      source,
      olderSource,
      { ...source, id: 'note-1', sourceKind: 'user_note' },
    ]),
  } as unknown as RecordRepository;
}

function audioDeletion(order: string[]): RecordingAudioDeletion {
  return {
    reconcile: jest.fn(async () => {
      order.push('reconcile');
    }),
    stage: jest.fn(async () => {
      order.push('stage');
    }),
    restore: jest.fn(async () => {
      order.push('restore');
    }),
    commit: jest.fn(async () => {
      order.push('commit');
    }),
  };
}

test('lists only audio recordings in newest-first order', async () => {
  const records = repository();
  const order: string[] = [];
  const audio = audioDeletion(order);
  const service = createRecordingLibraryService({
    loadRepository: async () => records,
    audioDeletion: audio,
  });

  await expect(service.list()).resolves.toEqual([source, olderSource]);
  expect(audio.reconcile).toHaveBeenCalledWith([source.id, olderSource.id]);
  expect(order).toEqual(['reconcile']);
});

test('commits staged audio after dependent source deletion succeeds', async () => {
  const order: string[] = [];
  const audio = audioDeletion(order);
  const memory = {} as AgentMemoryService;
  const service = createRecordingLibraryService({
    loadRepository: async () => repository(),
    openMemory: async () => {
      order.push('memory');
      return memory;
    },
    audioDeletion: audio,
    assertRecordingStopped: async () => {
      order.push('idle');
    },
    removeSource: jest.fn(async () => {
      order.push('source');
      return { sourceDeleted: true, memoriesDeleted: 1 };
    }),
  });

  await expect(service.deleteRecording(source.id)).resolves.toEqual({
    audioCleanupPending: false,
  });

  expect(order).toEqual(['idle', 'stage', 'memory', 'source', 'commit']);
  expect(audio.restore).not.toHaveBeenCalled();
});

test('keeps committed source deletion successful and retries staged audio on list refresh', async () => {
  const order: string[] = [];
  const audio = audioDeletion(order);
  jest
    .mocked(audio.commit)
    .mockRejectedValueOnce(new Error('file unlink failed'));
  const records = repository();
  jest.mocked(records.list).mockResolvedValueOnce([olderSource]);
  const service = createRecordingLibraryService({
    loadRepository: async () => records,
    openMemory: async () => ({}) as AgentMemoryService,
    audioDeletion: audio,
    assertRecordingStopped: async () => {},
    removeSource: jest.fn(async () => ({
      sourceDeleted: true,
      memoriesDeleted: 1,
    })),
  });

  await expect(service.deleteRecording(source.id)).resolves.toEqual({
    audioCleanupPending: true,
  });
  expect(audio.restore).not.toHaveBeenCalled();
  await service.list();
  expect(audio.reconcile).toHaveBeenCalledWith([olderSource.id]);
});

test('restores the staged audio when dependent source deletion fails', async () => {
  const order: string[] = [];
  const audio = audioDeletion(order);
  const service = createRecordingLibraryService({
    loadRepository: async () => repository(),
    openMemory: async () => {
      order.push('memory');
      return {} as AgentMemoryService;
    },
    audioDeletion: audio,
    assertRecordingStopped: async () => {
      order.push('idle');
    },
    removeSource: jest.fn(async () => {
      order.push('source');
      throw new Error('SQLCipher deletion failed');
    }),
  });

  await expect(service.deleteRecording(source.id)).rejects.toThrow(
    'SQLCipher deletion failed',
  );
  expect(order).toEqual(['idle', 'stage', 'memory', 'source', 'restore']);
  expect(audio.commit).not.toHaveBeenCalled();
});

test('does not stage files when the selected source is missing', async () => {
  const order: string[] = [];
  const audio = audioDeletion(order);
  const service = createRecordingLibraryService({
    loadRepository: async () => repository(null),
    audioDeletion: audio,
    assertRecordingStopped: async () => {
      order.push('idle');
    },
  });

  await expect(service.deleteRecording(source.id)).rejects.toThrow();
  expect(order).toEqual([]);
});
