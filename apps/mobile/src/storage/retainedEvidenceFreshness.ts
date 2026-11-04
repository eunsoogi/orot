import {
  STORAGE_TABLES,
  type SqlExecutor,
  type ManualHistoryRepository,
} from '@orot/storage';
import type { SavedSummarySource } from '../diseaseHypotheses/savedSummaries';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { assertSummaryPeriodCurrent } from './symptomSummaryPeriods';

/** Validate source revisions in the same transaction as the derived output write. */
export async function assertRetainedEvidenceCurrent(
  tx: SqlExecutor,
  sources: readonly SavedSummarySource[],
  manualHistory: ManualHistoryRepository,
) {
  for (const source of sources) {
    if (isPeriodSummarySource(source)) {
      await assertSummaryPeriodCurrent(tx, source);
      continue;
    }
    for (const record of source.records) {
      if (record.kind === 'manual_history') {
        const current = await manualHistory.getEvidence(record.id, tx);
        if (!current || fingerprint(current) !== record.revision)
          throw new Error('A cited source changed before saving.');
        continue;
      }
      const memory = record.kind === 'reviewed_memory';
      const table = memory
        ? 'agent_memory_records'
        : STORAGE_TABLES[record.kind].table;
      const column = memory ? 'record_json' : 'payload_json';
      const current = await tx.execute(
        `SELECT ${column} AS source_json FROM ${table} WHERE id = ?`,
        [record.id],
      );
      const serialized = current.rows[0]?.source_json;
      if (typeof serialized !== 'string')
        throw new Error('A cited source was removed before saving.');
      const parsed = JSON.parse(serialized);
      if (
        fingerprint(
          memory ? { text: parsed.text, meta: parsed.meta } : parsed,
        ) !== record.revision
      )
        throw new Error('A cited source changed before saving.');
      const stale = await tx.execute(
        'SELECT artifact_id FROM transcript_artifact_staleness WHERE artifact_kind = ? AND artifact_id = ? LIMIT 1',
        [record.kind, record.id],
      );
      if (stale.rows.length) throw new Error('A cited source is stale.');
    }
  }
}
