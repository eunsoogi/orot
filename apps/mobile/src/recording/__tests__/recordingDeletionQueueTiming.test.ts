import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import { createRecordingLibraryService } from '../recordingLibraryService';
import { RecordingDeletionTimingProbe } from '../recordingDeletionTimingProbe';

test.each([false, true])(
  'attributes waiting behind a prior library read independently of source I/O (read fails: %s)',
  async failRead => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    let now = 0;
    const stage = jest.fn(async () => {});
    const repository = {
      list: async () => [],
      get: async () => {
        now += 3;
        return { sourceKind: 'audio_recording' };
      },
    } as unknown as RecordRepository;
    const service = createRecordingLibraryService({
      loadRepository: async () => repository,
      assertRecordingStopped: async () => {},
      openMemory: async () => ({}) as AgentMemoryService,
      removeSource: async () => ({ sourceDeleted: true, memoriesDeleted: 0 }),
      audioDeletion: {
        reconcile: async () => {
          entered();
          await held;
          if (failRead) throw new Error('prior list failed');
        },
        stage,
        restore: async () => {},
        commit: async () => {},
      },
    });
    // The real service queue must preserve reconciliation/deletion exclusion even on failure.
    const listing = service.list().catch(error => error);
    await started;
    const probe = new RecordingDeletionTimingProbe(() => now);
    probe.mark('confirmation-tap');
    const deletion = service.deleteRecording('fresh-recording', probe);
    now = 5000;
    expect(stage).not.toHaveBeenCalled();
    expect(probe.snapshot().events).toEqual([
      { stage: 'confirmation-tap', phase: 'mark', elapsedMs: 0 },
      { stage: 'library-queue-wait', phase: 'begin', elapsedMs: 0 },
    ]);
    release();
    await listing;
    await expect(deletion).resolves.toEqual({ audioCleanupPending: false });
    expect(probe.snapshot().durationsMs).toMatchObject({
      libraryQueueWait: 5000,
      sourceRead: 3,
    });
    expect(stage).toHaveBeenCalledTimes(1);
  },
);
