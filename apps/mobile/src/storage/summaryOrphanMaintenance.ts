import type { SqlExecutor } from '@orot/storage';
import { completeSummaryDeletion } from './summaryDeletionPolicy';

/** Audit every setup, without re-preparing all deletion cascades per source kind.
 * Table names come only from the store's fixed schema map; kinds stay bound values.
 * Row triggers retain generated/cross-kind descendant deletion in this transaction.
 * This batches SQL work, never caches source validity or skips legacy policy audits. */
export async function removeOrphanSummaries(
  tx: SqlExecutor,
  sourceTables: Readonly<Record<string, string>>,
) {
  const candidates = Object.values(sourceTables).map(
    table =>
      `SELECT s.summary_id FROM symptom_summary_sources s WHERE s.record_kind = ? AND NOT EXISTS (SELECT 1 FROM ${table} source WHERE source.id = s.record_id)`,
  );
  await tx.execute(
    `DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (${candidates.join(' UNION ')})`,
    Object.keys(sourceTables),
  );
}
