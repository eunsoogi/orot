import { observeManualHistoryDeletionSql } from '../memory/observeManualHistoryDeletionSql';
import type { SavedMemoryDeletionTrace } from '../memory/savedMemoryDeletionDiagnostics';
import { openLocalStorage } from '../storage/secureDatabase';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';
import { SqlCipherRagEmbeddingStorage } from '../storage/ragEmbeddingStorage';
import type {
  ManualHistoryScreenRecord,
  ManualHistoryScreenRepository,
} from './types';

type StoredManualHistoryRepository = Awaited<
  ReturnType<typeof openLocalStorage>
>['manualHistory'];
type StoredManualHistoryEntry = NonNullable<
  Awaited<ReturnType<StoredManualHistoryRepository['get']>>
>;

function toScreenRecord(
  entry: StoredManualHistoryEntry,
): ManualHistoryScreenRecord {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    details: entry.details,
    effectiveDate: entry.effectiveDate,
    recordedAt: entry.recordedAt,
    provenance: { origin: entry.provenance.origin },
    reviewState: entry.reviewState,
    ...(entry.supersedesId ? { supersedesId: entry.supersedesId } : {}),
    ...(entry.correctionNote ? { correctionNote: entry.correctionNote } : {}),
  };
}

export async function openLocalManualHistoryRepository(
  trace?: SavedMemoryDeletionTrace,
  requireCurrentDeletionTarget = false,
): Promise<ManualHistoryScreenRepository> {
  const [storage, database] = await Promise.all([
    openLocalStorage(),
    openLocalAgentMemoryDatabase(),
  ]);
  const repository = storage.manualHistory;
  return {
    async list() {
      return (await repository.list()).map(toScreenRecord);
    },
    async create(input) {
      const entry = await repository.create({
        kind: input.kind,
        title: input.title,
        details: input.details,
        effectiveDate: input.effectiveDate,
      });
      return toScreenRecord(entry);
    },
    async correct(id, input) {
      const entry = await repository.correct(id, {
        kind: input.kind,
        title: input.title,
        details: input.details,
        effectiveDate: input.effectiveDate,
        ...(input.correctionNote
          ? { correctionNote: input.correctionNote }
          : {}),
      });
      return toScreenRecord(entry);
    },
    async history(id) {
      return (await repository.history(id)).map(toScreenRecord);
    },
    async delete(id) {
      // Admit a single protected writer. Warm schema proof, cold setup, and
      // source/vector retirement all use the caller-owned executor.
      let deleted = false;
      // Boundary changes are driven by callback admission and durable transaction
      // settlement, not by the UI assuming a pending promise has committed.
      let phase: 'queue' | 'lineage' | 'commit' = 'queue';
      trace?.('saved_memory_delete_queue', 'started');
      try {
        await database.transaction(async transaction => {
          trace?.('saved_memory_delete_queue', 'completed');
          phase = 'lineage';
          trace?.('saved_memory_delete_lineage', 'started');
          // Settings confirms the exact selected revision, not a future
          // successor. Check the tip in the writer that also deletes it.
          if (requireCurrentDeletionTarget) {
            const versions = await repository.history(id, transaction);
            if (versions[versions.length - 1]?.id !== id)
              throw new Error('Selected history is no longer current.');
          }
          deleted = await repository.delete(
            id,
            trace
              ? observeManualHistoryDeletionSql(transaction, trace)
              : transaction,
            async lineageIds => {
              trace?.('saved_memory_delete_vectors', 'started');
              try {
                const vectors =
                  await SqlCipherRagEmbeddingStorage.forCallerTransaction(
                    transaction,
                  );
                await vectors.deleteEvidence(lineageIds, [], transaction);
                trace?.('saved_memory_delete_vectors', 'completed');
              } catch (error) {
                trace?.('saved_memory_delete_vectors', 'failed');
                throw error;
              }
            },
          );
          trace?.('saved_memory_delete_lineage', 'completed');
          phase = 'commit';
          trace?.('saved_memory_delete_commit', 'started');
        });
        trace?.('saved_memory_delete_commit', 'completed');
      } catch (error) {
        trace?.(`saved_memory_delete_${phase}`, 'failed');
        throw error;
      }
      return deleted;
    },
  };
}
