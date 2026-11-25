import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import type { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import type { RecordingLibraryService } from '../recordingLibraryServiceTypes';
import { RecordingDeletionTimingProbe } from '../recordingDeletionTimingProbe';

interface RecordingDeletionFixture {
  readonly repository: RecordRepository;
  readonly memory: AgentMemoryService;
  readonly library: RecordingLibraryService;
  readonly audioOrder: readonly string[];
  readonly storage: SqlCipherAgentMemoryStorage;
}

/** Assert the canonical fixture can independently hold each measured production boundary. */
export async function verifyRecordingDeletionPhaseIsolation(
  harness: (sourceId: string) => Promise<RecordingDeletionFixture>,
): Promise<void> {
  const sourceId = 'diagnostic-gates-recording';
  const { repository, memory, library, audioOrder, storage } =
    await harness(sourceId);
  const snapshot =
    repository.listTypedSourceDeletionReferences!.bind(repository);
  const storageCommit = storage.commitSourceCascade.bind(storage);
  const snapshotGate = gate();
  const commitGate = gate();
  const snapshotSpy = jest
    .spyOn(repository, 'listTypedSourceDeletionReferences')
    .mockImplementationOnce(async (...args) => {
      await snapshotGate.hold();
      return snapshot(...args);
    });
  const commitSpy = jest
    .spyOn(storage, 'commitSourceCascade')
    .mockImplementationOnce(async (...args) => {
      await commitGate.hold();
      return storageCommit(...args);
    });
  const probe = new RecordingDeletionTimingProbe(() => 0);
  probe.mark('confirmation-tap');
  const deletion = library.deleteRecording(sourceId, probe);

  try {
    const prematureCompletion = deletion.then(() => {
      throw new Error('Deletion finished before the controlled phase');
    });
    await Promise.race([snapshotGate.entered, prematureCompletion]);
    const stages = () =>
      probe.snapshot().events.map(event => [event.stage, event.phase]);
    expect(stages()).toContainEqual(['protected-database-open', 'end']);
    expect(stages()).toContainEqual(['deletion-rag-prepare', 'end']);
    expect(stages().at(-1)).toEqual(['source-reference-snapshot', 'begin']);
    snapshotGate.release();

    await Promise.race([commitGate.entered, prematureCompletion]);
    expect(stages()).toContainEqual(['memory-provenance-scan', 'end']);
    // The native fast path has no speculative engine or ID-only forget stage.
    expect(stages()).not.toContainEqual(['memory-engine-acquire', 'begin']);
    expect(stages()).not.toContainEqual(['memory-forget', 'begin']);
    expect(stages().at(-1)).toEqual(['memory-batch-commit', 'begin']);
    expect(await repository.get('source_record', sourceId)).not.toBeNull();
    expect(audioOrder).toEqual(['stage']);
    commitGate.release();

    await expect(deletion).resolves.toEqual({ audioCleanupPending: false });
    expect(stages().map(([phase]) => phase)).toEqual(
      expect.arrayContaining([
        'source-reference-db-admission',
        'source-reference-sql',
        'source-reference-db-settlement',
        'memory-batch-db-admission',
        'memory-batch-state-read',
        'memory-batch-record-writes',
        'memory-batch-fence-writes',
        'memory-batch-db-settlement',
      ]),
    );
    expect(stages()).toContainEqual(['memory-batch-commit', 'end']);
    expect(stages()).toContainEqual(['database-delete-commit', 'end']);
    expect(await repository.get('source_record', sourceId)).toBeNull();
    expect(audioOrder).toEqual(['stage', 'commit']);
    expect(JSON.stringify(probe.snapshot())).not.toContain(sourceId);
  } finally {
    snapshotGate.release();
    commitGate.release();
    await Promise.allSettled([deletion]);
    snapshotSpy.mockRestore();
    commitSpy.mockRestore();
    await memory.close();
  }
}

function gate() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => {
    enter = resolve;
  });
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    entered,
    release,
    hold: () => {
      enter();
      return hold;
    },
  };
}
