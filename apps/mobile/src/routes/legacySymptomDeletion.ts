import {
  STORAGE_TABLES,
  type RecordKind,
  type RecordRepository,
  type SqlExecutor,
} from '@orot/storage';
import type { AgentMemoryService } from '@orot/agent-memory';
import type { LocalE5RagService } from '../rag/localE5RagService';

const pendingTable = 'legacy_symptom_deletion_pending';

async function ensurePendingTable(sql: SqlExecutor): Promise<void> {
  await sql.execute(
    `CREATE TABLE IF NOT EXISTS ${pendingTable} (id TEXT PRIMARY KEY NOT NULL)`,
  );
  // Other supported deletion paths must not leave a stale intent for a later record.
  await sql.execute(
    `CREATE TRIGGER IF NOT EXISTS legacy_symptom_pending_source_deleted AFTER DELETE ON symptom_entries BEGIN DELETE FROM ${pendingTable} WHERE id = OLD.id; END`,
  );
}

/** A durable intent makes interrupted memory and source cleanup visible after restart. */
export async function pendingSymptomDeletions(
  records: RecordRepository,
): Promise<string[]> {
  return records.transaction(async (_writer, sql) => {
    if (!sql) throw new Error('A deletion transaction is required.');
    await ensurePendingTable(sql);
    const result = await sql.execute(`SELECT id FROM ${pendingTable}`);
    return result.rows.map(row => {
      if (typeof row.id !== 'string')
        throw new Error('A deletion identifier is invalid.');
      return row.id;
    });
  });
}

/** Fences derived evidence and leaves a retryable intent if either stage fails. */
export async function removeLegacySymptom(
  records: RecordRepository,
  rag: Pick<LocalE5RagService, 'deleteChunks'>,
  memory: Pick<AgentMemoryService, 'removeSource'>,
  id: string,
): Promise<boolean> {
  const exists = await records.transaction(async (writer, sql) => {
    if (!sql) throw new Error('A deletion transaction is required.');
    if (!(await writer.get('symptom_entry', id))) return false;
    // These fences are untyped; never invalidate another record or transcript family.
    for (const kind of Object.keys(STORAGE_TABLES) as RecordKind[]) {
      if (kind !== 'symptom_entry' && (await writer.get(kind, id))) {
        throw new Error(
          'The legacy source identifier is shared by another record.',
        );
      }
    }
    const families = await sql.execute(
      "SELECT 1 AS present FROM transcript_segments WHERE json_extract(payload_json, '$.transcriptId') = ? LIMIT 1",
      [id],
    );
    if (families.rows.length)
      throw new Error(
        'The legacy source identifier is shared by a transcript.',
      );
    const history = await sql.execute(
      'SELECT 1 AS present FROM manual_history_entries WHERE id = ? LIMIT 1',
      [id],
    );
    if (history.rows.length)
      throw new Error(
        'The legacy source identifier is shared by manual history.',
      );
    await ensurePendingTable(sql);
    await sql.execute(`INSERT OR IGNORE INTO ${pendingTable} (id) VALUES (?)`, [
      id,
    ]);
    return true;
  });
  if (!exists) return false;
  const result = await memory.removeSource(id, () =>
    records.transaction(async (writer, sql) => {
      if (!sql) throw new Error('A deletion transaction is required.');
      await rag.deleteChunks([], [id], sql);
      const deleted = await writer.delete('symptom_entry', id);
      if (!deleted)
        throw new Error('The legacy source is no longer available.');
      await sql.execute(`DELETE FROM ${pendingTable} WHERE id = ?`, [id]);
      return true;
    }),
  );
  return result.sourceDeleted;
}
