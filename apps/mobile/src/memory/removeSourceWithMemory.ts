import type { AgentMemoryService } from '@orot/agent-memory';
import type { SqlDatabase } from '@orot/storage';
import type { LocalE5RagService } from '../rag/localE5RagService';
import { RecordIdSchema } from '@orot/domain';
import { createLocalE5RagService } from '../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import type { RecordingDeletionTimingProbe } from '../recording/recordingDeletionTiming';
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
  let derivedCleanupEnded = false;
  const endDerivedCleanup = (outcome: 'success' | 'failure') => {
    if (derivedCleanupEnded) return;
    derivedCleanupEnded = true;
    endRecordingDeletionTiming(timingProbe, 'derived-data-cleanup', outcome);
  };

  try {
    const normalizedSourceId = RecordIdSchema.parse(sourceId);
    const [database, repository] = await Promise.all([
      openLocalAgentMemoryDatabase(),
      openLocalStorage(),
    ]);
    const rag = deletionRag(database);
    await rag.prepare();
    // Capture cascade roots before SQL removal so transcript-only memory references are deleted too.
    const deletionReferences =
      await repository.listSourceDeletionReferences(normalizedSourceId);
    const result = await memory.removeSource(
      normalizedSourceId,
      () => {
        // End derived cleanup before the source transaction so the two timings do not overlap.
        endDerivedCleanup('success');
        return withRecordingDeletionTiming(
          timingProbe,
          'database-delete-commit',
          () =>
            repository.sourceRecords.delete(normalizedSourceId, transaction =>
              rag.deleteChunks([], [normalizedSourceId], transaction),
            ),
        );
      },
      deletionReferences,
    );
    endDerivedCleanup('success');
    return result;
  } catch (error) {
    endDerivedCleanup('failure');
    throw error;
  }
}
