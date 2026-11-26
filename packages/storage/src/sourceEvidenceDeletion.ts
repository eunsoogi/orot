import { RecordIdSchema } from '@orot/domain';
import { timeOwnedSqlTransaction, timeSqlWork } from './ownedSqlTiming';
import type { SqlTimingObserver } from './ownedSqlTiming';
import { deleteStoredRecord, readStoredRecord } from './recordPersistence';
import { stageSourceDeletionFences } from './sourceDeletionFenceWrites';
import { readOwnedDeletionReferences } from './sourceDeletionReferences';
import type { SqlDatabase, SqlExecutor } from './sql';

export type SourceDeletionTimingPhase =
  'admission' | 'references' | 'fences' | 'vectors' | 'cascade' | 'context' | 'settlement';

/** Keep vector fences, dependency cascades and context cleanup on the same SQL owner. */
export async function deleteSourceEvidence(
  database: SqlDatabase,
  id: string,
  withinDeletionTransaction?: (transaction: SqlExecutor) => Promise<void>,
  observe?: SqlTimingObserver<SourceDeletionTimingPhase>,
): Promise<boolean> {
  let deleted = false;
  await timeOwnedSqlTransaction(
    database,
    async (transaction) => {
      const sourceId = RecordIdSchema.parse(id);
      const references = await timeSqlWork(observe, 'references', async () => {
        if (!(await readStoredRecord(transaction, 'source_record', sourceId))) return;
        // Record kinds before the cascade inserts identity-only fences; retain unknown legacy fences.
        await transaction.execute(
          'CREATE TABLE IF NOT EXISTS typed_deletion_markers (marker_table TEXT NOT NULL, source_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (marker_table, source_id, kind))',
        );
        await transaction.execute(
          'CREATE TABLE IF NOT EXISTS typed_deletion_write_context (marker_table TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (marker_table, source_id))',
        );
        return readOwnedDeletionReferences(transaction, sourceId);
      });
      if (!references) return;
      const clear = await timeSqlWork(observe, 'fences', () =>
        stageSourceDeletionFences(transaction, references),
      );
      if (withinDeletionTransaction)
        await timeSqlWork(observe, 'vectors', () => withinDeletionTransaction(transaction));
      deleted = await timeSqlWork(observe, 'cascade', () =>
        deleteStoredRecord(transaction, 'source_record', sourceId),
      );
      await timeSqlWork(observe, 'context', clear);
    },
    observe &&
      ((phase, event) => {
        if (phase !== 'body') observe(phase, event);
      }),
  );
  return deleted;
}
