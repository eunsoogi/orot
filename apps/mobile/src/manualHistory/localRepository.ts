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

async function openHistoryActions(
  trace?: SavedMemoryDeletionTrace,
  requireCurrentDeletionTarget = false,
): Promise<
  ManualHistoryScreenRepository & {
    deleteCurrent(id: string, isCurrent: () => boolean): Promise<boolean>;
  }
> {
  const [storage, database] = await Promise.all([
    openLocalStorage(),
    openLocalAgentMemoryDatabase(),
  ]);
  const repository = storage.manualHistory;
  async function deleteCurrent(id: string, isCurrent = () => true) {
    const requireCurrent = () => {
      if (!isCurrent()) throw new Error('Selected history action retired.');
    };
    // Admit a single protected writer. Warm schema proof, cold setup, and
    // source/vector retirement all use the caller-owned executor.
    let deleted = false;
    // Boundary changes are driven by callback admission and durable transaction
    // settlement, not by the UI assuming a pending promise has committed.
    let phase: 'queue' | 'lineage' | 'commit' = 'queue';
    trace?.('saved_memory_delete_queue', 'started');
    try {
      await database.transaction(async transaction => {
        requireCurrent();
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
        requireCurrent();
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
        requireCurrent();
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
  }
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
    delete: id => deleteCurrent(id),
    deleteCurrent,
  };
}

/** Existing detail/history consumers do not need the list's extra retirement fence. */
export function openLocalManualHistoryRepository(
  trace?: SavedMemoryDeletionTrace,
  requireCurrentDeletionTarget = false,
): Promise<ManualHistoryScreenRepository> {
  return openHistoryActions(trace, requireCurrentDeletionTarget);
}

/** The list may only delete its confirmed exact, still-current original. */
export function openLocalCurrentHistoryDeletion() {
  return openHistoryActions(undefined, true);
}
