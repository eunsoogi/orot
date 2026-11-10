import {
  STORAGE_TABLES,
  type SqlExecutor,
  type ManualHistoryRepository,
} from '@orot/storage';
import type { SavedRecordSummarySource } from '../diseaseHypotheses/savedSummaries';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { assertSummarySourceAvailable } from './symptomSummaryQuarantine';

/** Apply the same source and quarantine checks to every retained artifact. */
export async function assertRetainedRecordsCurrent(
  tx: SqlExecutor,
  records: SavedRecordSummarySource['records'],
  manualHistory: ManualHistoryRepository,
) {
  for (const record of records) {
    if (record.kind === 'manual_history') {
      const current = await manualHistory.getEvidence(record.id, tx);
      if (!current || fingerprint(current) !== record.revision)
        throw new RetainedSourceInvalidError(
          'A cited source changed before saving.',
          current ? 'changed' : 'deleted',
        );
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
      throw new RetainedSourceInvalidError(
        'A cited source was removed before saving.',
        'deleted',
      );
    await assertSummarySourceAvailable(tx, record.kind, record.id, serialized);
    const parsed = JSON.parse(serialized);
    if (
      fingerprint(
        memory ? { text: parsed.text, meta: parsed.meta } : parsed,
      ) !== record.revision
    )
      throw new RetainedSourceInvalidError(
        'A cited source changed before saving.',
        'changed',
      );
    const stale = await tx.execute(
      'SELECT artifact_id FROM transcript_artifact_staleness WHERE artifact_kind = ? AND artifact_id = ? LIMIT 1',
      [record.kind, record.id],
    );
    if (stale.rows.length)
      throw new RetainedSourceInvalidError('A cited source is stale.', 'stale');
  }
}
