import { type RecordRepository, type SqlExecutor } from '@orot/storage';
import type { LocalE5RagService } from '../rag/localE5RagService';

const pendingTable = 'legacy_symptom_deletion_pending';
const deletedTable = 'legacy_symptom_deleted';

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
  rag: Pick<LocalE5RagService, 'deleteSymptom'>,
  id: string,
): Promise<boolean> {
  const exists = await records.transaction(async (writer, sql) => {
    if (!sql) throw new Error('A deletion transaction is required.');
    if (!(await writer.get('symptom_entry', id))) return false;
    await ensurePendingTable(sql);
    await sql.execute(`INSERT OR IGNORE INTO ${pendingTable} (id) VALUES (?)`, [
      id,
    ]);
    await sql.execute(`INSERT OR IGNORE INTO ${deletedTable} (id) VALUES (?)`, [
      id,
    ]);
    return true;
  });
  if (!exists) return false;
  return records.transaction(async (writer, sql) => {
    if (!sql) throw new Error('A deletion transaction is required.');
    const record = await writer.get('symptom_entry', id);
    if (!record) throw new Error('The legacy source is no longer available.');
    await rag.deleteSymptom(record, sql);
    const deleted = await writer.delete('symptom_entry', id);
    if (!deleted) throw new Error('The legacy source is no longer available.');
    await sql.execute(`DELETE FROM ${pendingTable} WHERE id = ?`, [id]);
    return true;
  });
}
