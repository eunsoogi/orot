import type { SqlDatabase } from '@orot/storage';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import {
  deletedSymptomIds,
  referencesDeletedSymptom,
} from './agentMemorySymptomQuarantine';
import {
  assertNoSourceReference,
  decodeAgentMemoryRecord,
  insertAgentMemoryRecord,
  listSupersededTranscriptRevisionIds,
  referencesAnySource,
} from './agentMemoryStorageRecords';
import { writeAgentMemoryDeletionMarkers } from './agentMemoryDeletionMarkers';

/** Commit memory changes and deletion fences atomically. */
export async function commitAgentMemoryWrites(
  database: SqlDatabase,
  writes: Map<string, PersistedMemoryRecord | null>,
  removedSourceIdsToAdd: Set<string>,
  removedKinds: Map<string, readonly string[] | undefined>,
) {
  await database.transaction(async transaction => {
    const removedResult = await transaction.execute(
      'SELECT source_id FROM agent_memory_removed_sources ORDER BY source_id',
    );
    const removedSourceIds = new Set(
      removedResult.rows.flatMap(row =>
        typeof row.source_id === 'string' ? [row.source_id] : [],
      ),
    );
    for (const sourceId of removedSourceIdsToAdd)
      removedSourceIds.add(sourceId);
    const invalidatedSourceIds =
      await listSupersededTranscriptRevisionIds(transaction);
    const removedSymptoms = await deletedSymptomIds(transaction);
    for (const record of writes.values()) {
      if (record) {
        if (referencesDeletedSymptom(record, removedSymptoms))
          throw new Error('Memory cannot reference a deleted symptom.');
        assertNoSourceReference(
          record,
          removedSourceIds,
          'Memory cannot reference a source being or already removed.',
        );
        assertNoSourceReference(
          record,
          invalidatedSourceIds,
          'Memory cannot reference a superseded transcript revision.',
        );
      }
    }
    if (removedSourceIdsToAdd.size > 0 || invalidatedSourceIds.size > 0) {
      const records = await transaction.execute(
        'SELECT id, record_json FROM agent_memory_records ORDER BY id',
      );
      for (const row of records.rows) {
        const record = decodeAgentMemoryRecord(row.record_json);
        // A separately requested source deletion still owns its existing hard-delete boundary.
        if (
          referencesDeletedSymptom(record, removedSymptoms) &&
          !referencesAnySource(record, removedSourceIdsToAdd)
        )
          continue;
        if (
          referencesAnySource(record, removedSourceIds) ||
          referencesAnySource(record, invalidatedSourceIds)
        ) {
          await transaction.execute(
            'DELETE FROM agent_memory_records WHERE id = ?',
            [record.id],
          );
        }
      }
    }
    for (const [id, record] of writes) {
      if (record) await insertAgentMemoryRecord(transaction, record);
      else
        await transaction.execute(
          'DELETE FROM agent_memory_records WHERE id = ?',
          [id],
        );
    }
    await writeAgentMemoryDeletionMarkers(
      transaction,
      removedSourceIdsToAdd,
      removedKinds,
    );
  });
}
