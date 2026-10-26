import { openLocalStorage } from '../storage/secureDatabase';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';
import { createLocalE5RagService } from '../rag/localE5RagService';
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

export async function openLocalManualHistoryRepository(): Promise<ManualHistoryScreenRepository> {
  const [storage, database] = await Promise.all([
    openLocalStorage(),
    openLocalAgentMemoryDatabase(),
  ]);
  const repository = storage.manualHistory;
  const rag = createLocalE5RagService(database);
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
      let deleted = false;
      await database.transaction(async transaction => {
        let lineage: StoredManualHistoryEntry[];
        try {
          lineage = await repository.history(id, transaction);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === 'Manual history entry not found.'
          )
            return;
          throw error;
        }
        deleted = await repository.delete(id, transaction);
        if (deleted) {
          // Remove indexed vectors in the same SQLCipher transaction as the complete correction lineage.
          await rag.deleteChunks(
            [],
            lineage.map(entry => entry.id),
            transaction,
          );
        }
      });
      return deleted;
    },
  };
}
