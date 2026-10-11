import type { AgentMemoryService } from '@orot/agent-memory';
import type { SourceRecord } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import {
  createRecordingLibraryService,
  type RecordingAudioDeletion,
} from '../recordingLibraryService';

const recording: SourceRecord = {
  id: 'recording-concurrent-delete',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '저장된 녹음',
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function createHarness(waitForSourceRemoval: () => Promise<void>) {
  const state = {
    source: recording as SourceRecord | null,
    originalAudioExists: true,
    stagedAudioExists: false,
  };
  const order: string[] = [];
  const repository = {
    get: jest.fn(async (_table: string, sourceId: string) =>
      state.source?.id === sourceId ? state.source : null,
    ),
    list: jest.fn(async (table: string) =>
      table === 'source_record' && state.source ? [state.source] : [],
    ),
  } as unknown as RecordRepository;
  const audio: RecordingAudioDeletion = {
    reconcile: jest.fn(async sourceIds => {
      order.push('reconcile');
      // Reconciliation models crash recovery by restoring staged audio for a live source.
      if (sourceIds.includes(recording.id) && state.stagedAudioExists) {
        state.originalAudioExists = true;
        state.stagedAudioExists = false;
      }
    }),
    stage: jest.fn(async () => {
      order.push('stage');
      state.originalAudioExists = false;
      state.stagedAudioExists = true;
    }),
    restore: jest.fn(async () => {
      order.push('restore');
      state.originalAudioExists = true;
      state.stagedAudioExists = false;
    }),
    commit: jest.fn(async () => {
      order.push('commit');
      state.stagedAudioExists = false;
    }),
  };
  const service = createRecordingLibraryService({
    loadRepository: async () => repository,
    openMemory: async () => ({}) as AgentMemoryService,
    audioDeletion: audio,
    assertRecordingStopped: async () => {},
    removeSource: async () => {
      await waitForSourceRemoval();
      state.source = null;
      return { sourceDeleted: true, memoriesDeleted: 0 };
    },
  });
  return { audio, order, service, state };
}

test('queues list reconciliation until a concurrent delete commits', async () => {
  const sourceRemoval = deferred();
  let started!: () => void;
  const startedPromise = new Promise<void>(resolve => {
    started = resolve;
  });
  const harness = createHarness(async () => {
    started();
    await sourceRemoval.promise;
  });
  const deletion = harness.service.deleteRecording(recording.id);
  await startedPromise;

  const listing = harness.service.listSummaries!();
  await flushMicrotasks();
  const reconciledBeforeDeleteFinished =
    jest.mocked(harness.audio.reconcile).mock.calls.length > 0;
  sourceRemoval.resolve();
  await deletion;
  await expect(listing).resolves.toEqual([]);

  expect(reconciledBeforeDeleteFinished).toBe(false);
  expect(harness.order).toEqual(['stage', 'commit', 'reconcile']);
  expect(harness.audio.reconcile).toHaveBeenCalledWith([]);
  expect(harness.state.originalAudioExists).toBe(false);
  expect(harness.state.stagedAudioExists).toBe(false);
});

test('restores failed deletions before a queued list reconciles the live source', async () => {
  const sourceRemoval = deferred();
  let started!: () => void;
  const startedPromise = new Promise<void>(resolve => {
    started = resolve;
  });
  const harness = createHarness(async () => {
    started();
    await sourceRemoval.promise;
    throw new Error('SQLCipher deletion failed');
  });
  const deletion = harness.service.deleteRecording(recording.id);
  await startedPromise;

  const listing = harness.service.listSummaries!();
  await flushMicrotasks();
  const reconciledBeforeDeleteFinished =
    jest.mocked(harness.audio.reconcile).mock.calls.length > 0;
  sourceRemoval.reject(new Error('SQLCipher deletion failed'));
  await expect(deletion).rejects.toThrow('SQLCipher deletion failed');
  await expect(listing).resolves.toHaveLength(1);

  expect(reconciledBeforeDeleteFinished).toBe(false);
  expect(harness.order).toEqual(['stage', 'restore', 'reconcile']);
  expect(harness.audio.reconcile).toHaveBeenCalledWith([recording.id]);
  expect(harness.state.originalAudioExists).toBe(true);
  expect(harness.state.stagedAudioExists).toBe(false);
});
