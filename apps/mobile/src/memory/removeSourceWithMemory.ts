import type { AgentMemoryService } from '@orot/agent-memory';
import type {
  OwnedSqlPhase,
  SourceDeletionTimingPhase,
  SqlDatabase,
  SqlTimingObserver,
} from '@orot/storage';
import type { LocalE5RagService } from '../rag/localE5RagService';
import { RecordIdSchema } from '@orot/domain';
import { createLocalE5RagService } from '../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import type { RecordingDeletionTimingProbe } from '../recording/recordingDeletionTiming';
import { notifyLocalSourceDeleted } from '../storage/localDataClearEvents';
import {
  beginRecordingDeletionTiming,
  endRecordingDeletionTiming,
  withRecordingDeletionTiming,
} from '../recording/recordingDeletionTiming';

export interface SourceMemoryDeletionResult {
  readonly sourceDeleted: boolean;
  readonly memoriesDeleted: number;
}

// Preparation is tied to the open database, never to a recording or a process-wide boolean.
// A reopened database gets fresh schema checks; prepare() itself retries a failed initialization.
const deletionRagServices = new WeakMap<SqlDatabase, LocalE5RagService>();

function deletionRag(database: SqlDatabase): LocalE5RagService {
  let rag = deletionRagServices.get(database);
  if (!rag) {
    rag = createLocalE5RagService(database);
    deletionRagServices.set(database, rag);
  }
  return rag;
}

/** Deletes a source record and memories that cite the source or one of its cascading records. */
export async function removeLocalSourceWithMemory(
  sourceId: string,
  memory: AgentMemoryService,
  timingProbe?: RecordingDeletionTimingProbe,
): Promise<SourceMemoryDeletionResult> {
  beginRecordingDeletionTiming(timingProbe, 'derived-data-cleanup');
  const observeMemoryStage: NonNullable<
    Parameters<AgentMemoryService['removeSource']>[4]
  > = (stage, event) => {
    const span = {
      queue: 'memory-queue-wait',
      provenance: 'memory-provenance-scan',
      engine: 'memory-engine-acquire',
      forget: 'memory-forget',
      fences: 'memory-deletion-fences',
      commit: 'memory-batch-commit',
      'batch-admission': 'memory-batch-db-admission',
      'batch-state-read': 'memory-batch-state-read',
      'batch-record-writes': 'memory-batch-record-writes',
      'batch-fence-writes': 'memory-batch-fence-writes',
      'batch-settlement': 'memory-batch-db-settlement',
    } as const;
    const name = span[stage];
    if (event === 'begin') beginRecordingDeletionTiming(timingProbe, name);
    else endRecordingDeletionTiming(timingProbe, name, event);
  };
  const observeSnapshot: SqlTimingObserver<OwnedSqlPhase> = (phase, event) => {
    const span = {
      admission: 'source-reference-db-admission',
      body: 'source-reference-sql',
      settlement: 'source-reference-db-settlement',
    } as const;
    if (event === 'begin')
      beginRecordingDeletionTiming(timingProbe, span[phase]);
    else endRecordingDeletionTiming(timingProbe, span[phase], event);
  };
  const observeDelete: SqlTimingObserver<SourceDeletionTimingPhase> = (
    phase,
    event,
  ) => {
    const span = {
      admission: 'source-delete-db-admission',
      references: 'source-delete-reference-sql',
      fences: 'source-delete-fence-sql',
      vectors: 'source-delete-vector-sql',
      cascade: 'source-delete-cascade-sql',
      context: 'source-delete-context-sql',
      settlement: 'source-delete-db-settlement',
    } as const;
    if (event === 'begin')
      beginRecordingDeletionTiming(timingProbe, span[phase]);
    else endRecordingDeletionTiming(timingProbe, span[phase], event);
  };
  let derivedCleanupEnded = false;
  const endDerivedCleanup = (outcome: 'success' | 'failure') => {
    if (derivedCleanupEnded) return;
    derivedCleanupEnded = true;
    endRecordingDeletionTiming(timingProbe, 'derived-data-cleanup', outcome);
  };

  try {
    const normalizedSourceId = RecordIdSchema.parse(sourceId);
    const [database, repository] = await withRecordingDeletionTiming(
      timingProbe,
      'protected-database-open',
      () => Promise.all([openLocalAgentMemoryDatabase(), openLocalStorage()]),
    );
    const rag = deletionRag(database);
    await withRecordingDeletionTiming(timingProbe, 'deletion-rag-prepare', () =>
      rag.prepare(),
    );
    // Capture cascade roots before SQL removal so transcript-only memory references are deleted too.
    const { typedReferences, deletionReferences } =
      await withRecordingDeletionTiming(
        timingProbe,
        'source-reference-snapshot',
        async () => {
          const typed = await repository.listTypedSourceDeletionReferences?.(
            normalizedSourceId,
            ...(timingProbe ? [observeSnapshot] : []),
          );
          const references = typed
            ? [...new Set(typed.map(reference => reference.id))].sort()
            : await repository.listSourceDeletionReferences(normalizedSourceId);
          return { typedReferences: typed, deletionReferences: references };
        },
      );
    // Memory invalidation commits before source removal; refresh even if the latter fails.
    const result = await memory
      .removeSource(
        normalizedSourceId,
        () => {
          // End derived cleanup before the source transaction so the two timings do not overlap.
          endDerivedCleanup('success');
          return withRecordingDeletionTiming(
            timingProbe,
            'database-delete-commit',
            () =>
              repository.sourceRecords.delete(
                normalizedSourceId,
                transaction =>
                  rag.deleteChunks([], [normalizedSourceId], transaction),
                ...(timingProbe ? [observeDelete] : []),
              ),
          );
        },
        deletionReferences,
        typedReferences,
        ...(timingProbe ? [observeMemoryStage] : []),
      )
      .finally(notifyLocalSourceDeleted);
    endDerivedCleanup('success');
    return result;
  } catch (error) {
    endDerivedCleanup('failure');
    throw error;
  }
}
