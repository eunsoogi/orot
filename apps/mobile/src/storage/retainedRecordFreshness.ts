import { memoryParentAvailable } from './agentMemoryParentQuarantine';
import { type SqlExecutor, type ManualHistoryRepository } from '@orot/storage';
import type { SavedRecordSummarySource } from '../diseaseHypotheses/savedSummaries';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import {
  deletedSymptomIds,
  referencesDeletedSymptom,
} from './agentMemorySymptomQuarantine';
import { decodeAgentMemoryRecord } from './agentMemoryStorageRecords';
import {
  readRetainedRecordRows,
  retainedRecordKey,
} from './retainedRecordRows';

/** Apply the same source and quarantine checks to every retained artifact. */
export async function assertRetainedRecordsCurrent(
  tx: SqlExecutor,
  records: SavedRecordSummarySource['records'],
  manualHistory: ManualHistoryRepository,
) {
  const batch = await readRetainedRecordRows(tx, records);
  // Only symptoms and reviewed memories can reference the legacy symptom quarantine.
  // Read it once per invocation, never once per sensor sample or across transactions.
  const deleted = batch.records.some(
    record =>
      record.kind === 'symptom_entry' || record.kind === 'reviewed_memory',
  )
    ? await deletedSymptomIds(tx)
    : new Set<string>();
  for (const record of batch.records) {
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
    const current = batch.rows.get(retainedRecordKey(record));
    const serialized = current?.serialized;
    if (typeof serialized !== 'string')
      throw new RetainedSourceInvalidError(
        'A cited source was removed before saving.',
        'deleted',
      );
    if (
      (record.kind === 'symptom_entry' && deleted.has(record.id)) ||
      (memory &&
        referencesDeletedSymptom(decodeAgentMemoryRecord(serialized), deleted))
    )
      throw new RetainedSourceInvalidError(
        'A cited source was removed before saving.',
        'deleted',
      );
    if (
      memory &&
      !(await memoryParentAvailable(tx, decodeAgentMemoryRecord(serialized)))
    )
      throw new RetainedSourceInvalidError(
        'The reviewed memory parent is unavailable.',
      );
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
    if (current?.stale)
      throw new RetainedSourceInvalidError('A cited source is stale.', 'stale');
  }
}
