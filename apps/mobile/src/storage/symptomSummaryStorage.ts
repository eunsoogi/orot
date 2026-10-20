import { STORAGE_TABLES, type SqlDatabase } from '@orot/storage';
import type { SymptomSummaryStorage } from '../diseaseHypotheses/savedSummaries';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';

/** Append-only generated results live in the existing SQLCipher database, never plaintext preferences. */
export function createSymptomSummaryStorage(
  database: SqlDatabase,
): SymptomSummaryStorage {
  let ready: Promise<void> | undefined;
  const ensure = () =>
    (ready ??= setup().catch(error => {
      ready = undefined;
      throw error;
    }));
  async function setup() {
    await database.transaction(async tx => {
      await tx.execute(
        'CREATE TABLE IF NOT EXISTS symptom_summary_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, model_name TEXT NOT NULL, result_json TEXT NOT NULL)',
      );
      await tx.execute(
        'CREATE INDEX IF NOT EXISTS symptom_summary_order ON symptom_summary_runs (created_at DESC, id DESC)',
      );
      await tx.execute(
        'CREATE TABLE IF NOT EXISTS symptom_summary_sources (summary_id TEXT NOT NULL REFERENCES symptom_summary_runs(id) ON DELETE CASCADE, record_kind TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY(summary_id, record_kind, record_id))',
      );
      await tx.execute(
        'CREATE INDEX IF NOT EXISTS symptom_summary_source_identity ON symptom_summary_sources (record_kind, record_id)',
      );
      // Delete derived health text when a cited row is deleted, including direct repository deletion.
      for (const [kind, { table }] of Object.entries(STORAGE_TABLES)) {
        await tx.execute(
          `CREATE TRIGGER IF NOT EXISTS summary_source_deleted_${kind} AFTER DELETE ON ${table} BEGIN DELETE FROM symptom_summary_runs WHERE id IN (SELECT summary_id FROM symptom_summary_sources WHERE record_kind = '${kind}' AND record_id = OLD.id); END`,
        );
      }
      const memory = await tx.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory_records'",
      );
      if (memory.rows.length)
        await tx.execute(
          "CREATE TRIGGER IF NOT EXISTS summary_memory_deleted AFTER DELETE ON agent_memory_records BEGIN DELETE FROM symptom_summary_runs WHERE id IN (SELECT summary_id FROM symptom_summary_sources WHERE record_kind = 'reviewed_memory' AND record_id = OLD.id); END",
        );
    });
  }
  return {
    async append(value) {
      await ensure();
      const serialized = JSON.stringify(value);
      if (serialized.length > 128_000 || !decodeSavedSymptomSummary(serialized))
        throw new Error('The summary cannot be saved.');
      await database.transaction(async tx => {
        const existing = await tx.execute(
          'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
          [value.id],
        );
        if (existing.rows.length) {
          if (existing.rows[0]?.result_json !== serialized)
            throw new Error('A different result already owns this summary ID.');
          return;
        }
        // Recheck inside the write transaction so deletion cannot race a completed source read.
        for (const source of value.sources)
          for (const record of source.records) {
            const memory = record.kind === 'reviewed_memory';
            const table = memory
              ? 'agent_memory_records'
              : STORAGE_TABLES[record.kind as keyof typeof STORAGE_TABLES]
                  .table;
            const column = memory ? 'record_json' : 'payload_json';
            const current = await tx.execute(
              `SELECT ${column} AS source_json FROM ${table} WHERE id = ?`,
              [record.id],
            );
            const serializedSource = current.rows[0]?.source_json;
            if (typeof serializedSource !== 'string')
              throw new Error('A cited source was removed before saving.');
            const parsed = JSON.parse(serializedSource);
            const revision = fingerprint(
              memory ? { text: parsed.text, meta: parsed.meta } : parsed,
            );
            if (revision !== record.revision)
              throw new Error('A cited source changed before saving.');
            const stale = await tx.execute(
              'SELECT artifact_id FROM transcript_artifact_staleness WHERE artifact_kind = ? AND artifact_id = ? LIMIT 1',
              [record.kind, record.id],
            );
            if (stale.rows.length) throw new Error('A cited source is stale.');
          }
        await tx.execute(
          'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
          [value.id, value.createdAt, value.modelName, serialized],
        );
        for (const source of value.sources)
          for (const record of source.records) {
            await tx.execute(
              'INSERT OR IGNORE INTO symptom_summary_sources (summary_id, record_kind, record_id) VALUES (?, ?, ?)',
              [value.id, record.kind, record.id],
            );
          }
      });
    },
    async list(before) {
      await ensure();
      // A stable cursor and fixed page size bound history reads independently of total saved runs.
      const rows = await database.execute(
        'SELECT id, created_at, model_name FROM symptom_summary_runs WHERE (? IS NULL OR id < ?) ORDER BY id DESC LIMIT 10',
        [before ?? null, before ?? null],
      );
      return rows.rows.flatMap(row =>
        typeof row.id === 'string' &&
        typeof row.created_at === 'string' &&
        typeof row.model_name === 'string'
          ? [
              {
                id: row.id,
                createdAt: row.created_at,
                modelName: row.model_name,
              },
            ]
          : [],
      );
    },
    async read(id) {
      await ensure();
      const result = await database.execute(
        'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
        [id],
      );
      return decodeSavedSymptomSummary(result.rows[0]?.result_json);
    },
  };
}
