import { ManualHistoryEntrySchema } from '@orot/domain';
import type { ManualHistoryEntry } from '@orot/domain';
import type { SqlExecutor, SqlValue } from './sql';

export function decodeManualHistoryRow(row: Record<string, SqlValue>): ManualHistoryEntry {
  if (typeof row.payload_json !== 'string') throw new Error('A stored manual history entry is invalid.');
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json) as unknown;
  } catch {
    throw new Error('A stored manual history entry is invalid.');
  }

  let entry: ManualHistoryEntry;
  try {
    entry = ManualHistoryEntrySchema.parse(payload);
  } catch {
    throw new Error('A stored manual history entry is invalid.');
  }

  const known = entry.effectiveDate.status === 'known';
  const effectiveDate = known ? entry.effectiveDate.date : null;
  if (
    row.id !== entry.id ||
    row.entry_kind !== entry.kind ||
    row.effective_date !== effectiveDate ||
    row.date_known !== (known ? 1 : 0) ||
    row.recorded_at !== entry.recordedAt ||
    row.ingested_at !== entry.ingestedAt ||
    row.supersedes_id !== (entry.supersedesId ?? null)
  ) {
    throw new Error('A stored manual history entry is inconsistent.');
  }
  return entry;
}

const SELECT_MANUAL_HISTORY =
  'SELECT id, entry_kind, effective_date, date_known, recorded_at, ingested_at, ' +
  'supersedes_id, payload_json FROM manual_history_entries ';

export async function readManualHistoryEntry(
  executor: SqlExecutor,
  id: string,
): Promise<ManualHistoryEntry | null> {
  const result = await executor.execute(SELECT_MANUAL_HISTORY + 'WHERE id = ? LIMIT 1', [id]);
  return result.rows.length === 0 ? null : decodeManualHistoryRow(result.rows[0]);
}

export async function readSuccessor(
  executor: SqlExecutor,
  id: string,
): Promise<ManualHistoryEntry | null> {
  const result = await executor.execute(SELECT_MANUAL_HISTORY + 'WHERE supersedes_id = ? LIMIT 2', [id]);
  if (result.rows.length > 1) throw new Error('Manual history correction lineage is invalid.');
  return result.rows.length === 0 ? null : decodeManualHistoryRow(result.rows[0]);
}

export async function insertManualHistoryEntry(
  executor: SqlExecutor,
  input: ManualHistoryEntry,
): Promise<void> {
  const entry = ManualHistoryEntrySchema.parse(input);
  const dateKnown = entry.effectiveDate.status === 'known';
  await executor.execute(
    'INSERT INTO manual_history_entries ' +
      '(id, entry_kind, effective_date, date_known, recorded_at, ingested_at, supersedes_id, payload_json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      entry.id,
      entry.kind,
      dateKnown ? entry.effectiveDate.date : null,
      dateKnown ? 1 : 0,
      entry.recordedAt,
      entry.ingestedAt,
      entry.supersedesId ?? null,
      JSON.stringify(entry),
    ],
  );
}
