import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type { SqlTransaction } from '@orot/storage';
import {
  assertNoSourceReference,
  reconcileAgentMemoryRecords,
  listSupersededTranscriptRevisionIds,
  referencesAnySource,
} from './agentMemoryStorageRecords';
import { assertSafeSymptomCompaction } from './agentMemorySymptomQuarantine';

/** Compaction keeps quarantine rows intact and applies the existing source fences atomically. */
export async function compactAgentMemory(
  transaction: SqlTransaction,
  records: PersistedMemoryRecord[],
): Promise<void> {
  await assertSafeSymptomCompaction(transaction, records);
  const removed = await transaction.execute(
    'SELECT source_id FROM agent_memory_removed_sources ORDER BY source_id',
  );
  const removedIds = new Set(
    removed.rows.flatMap(row =>
      typeof row.source_id === 'string' ? [row.source_id] : [],
    ),
  );
  const invalidated = await listSupersededTranscriptRevisionIds(transaction);
  for (const record of records)
    assertNoSourceReference(
      record,
      removedIds,
      'Memory cannot reference a source being or already removed.',
    );
  const current = records.filter(
    record => !referencesAnySource(record, invalidated),
  );
  await reconcileAgentMemoryRecords(transaction, current);
}
