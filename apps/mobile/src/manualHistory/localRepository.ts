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

export async function openLocalManualHistoryRepository(): Promise<ManualHistoryScreenRepository> {
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
      await database.transaction(async transaction => {
        deleted = await repository.delete(id, transaction, async lineageIds => {
          const vectors =
            await SqlCipherRagEmbeddingStorage.forCallerTransaction(
              transaction,
            );
          await vectors.deleteEvidence(lineageIds, [], transaction);
        });
      });
      return deleted;
    },
  };
}
