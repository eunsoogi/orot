import type { AgentMemoryService } from '@orot/agent-memory';
import type { SqlDatabase } from '@orot/storage';
import type { LocalE5RagService } from '../rag/localE5RagService';
import { RecordIdSchema } from '@orot/domain';
import { createLocalE5RagService } from '../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';

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
): Promise<SourceMemoryDeletionResult> {
  const normalizedSourceId = RecordIdSchema.parse(sourceId);
  const [database, repository] = await Promise.all([
    openLocalAgentMemoryDatabase(),
    openLocalStorage(),
  ]);
  const rag = deletionRag(database);
  await rag.prepare();
  // Capture the same cascade roots before SQL removal so transcript-only memory references are deleted too.
  const deletionReferences =
    await repository.listSourceDeletionReferences(normalizedSourceId);
  return memory.removeSource(
    normalizedSourceId,
    () =>
      repository.sourceRecords.delete(normalizedSourceId, transaction =>
        rag.deleteChunks([], [normalizedSourceId], transaction),
      ),
    deletionReferences,
  );
}
