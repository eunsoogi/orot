import {
  createManualHistoryRepository,
  STORAGE_TABLES,
  type SqlDatabase,
} from '@orot/storage';
import type { SymptomSummaryStorage } from '../diseaseHypotheses/savedSummaries';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import {
  hasCompleteSummaryLineage,
  isPeriodSummarySource,
} from '../diseaseHypotheses/savedSummaries';
import { visibleSummary } from './symptomSummaryQuarantine';
import {
  setupSummaryPeriods,
  appendSummaryPeriod,
} from './symptomSummaryPeriods';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';
import { memoryContentChangedPredicate } from './memoryContentChange';
import { setupSummaryParentMutationGuards } from './summaryParentMutationGuards';
import { setupResearchArtifactGuards } from './researchArtifactGuards';
import { setupResearchInputGuards } from './researchInputGuards';
import { completeSummaryDeletion } from './summaryDeletionPolicy';
import {
  isGeneratedConversationSource,
  isGeneratedSummarySource,
  isGeneratedResearchSource,
} from '../ragConversation/conversationArtifactSources';

/** Append-only generated results live in the existing SQLCipher database, never plaintext preferences. */
export function createSymptomSummaryStorage(
  database: SqlDatabase,
): SymptomSummaryStorage {
  let ready: Promise<void> | undefined;
  const manualHistory = createManualHistoryRepository(database);
  const ensure = () =>
    (ready ??= setup().catch(error => {
      ready = undefined;
      throw error;
    }));
  async function setup() {
    // Atomic period revalidation may sort private values even when the reader adapter was not opened first.
    await database.execute('PRAGMA temp_store = MEMORY');
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
      // Generated summary ancestry can include conversations before that catalog opens.
      await tx.execute(
        'CREATE TABLE IF NOT EXISTS conversation_artifact_sources (artifact_id TEXT NOT NULL, record_kind TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY (artifact_id, record_kind, record_id))',
      );
      await tx.execute(
        'CREATE INDEX IF NOT EXISTS symptom_summary_source_identity ON symptom_summary_sources (record_kind, record_id)',
      );
      // SQLCipher connections may disable foreign keys; dependency rows are only a projection.
      await tx.execute(
        'CREATE TRIGGER IF NOT EXISTS summary_source_run_deleted AFTER DELETE ON symptom_summary_runs BEGIN DELETE FROM symptom_summary_sources WHERE summary_id = OLD.id; END',
      );
      await tx.execute(
        'DELETE FROM symptom_summary_sources WHERE NOT EXISTS (SELECT 1 FROM symptom_summary_runs WHERE id = summary_id)',
      );
      await setupSummaryPeriods(tx);
      // Delete derived health text when a cited row is deleted, including direct repository deletion.
      for (const [kind, { table }] of Object.entries(STORAGE_TABLES)) {
        await tx.execute(
          `DROP TRIGGER IF EXISTS summary_source_deleted_${kind}`,
        );
        await tx.execute(
          `CREATE TRIGGER summary_source_deleted_${kind} AFTER DELETE ON ${table} BEGIN DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (SELECT summary_id FROM symptom_summary_sources WHERE record_kind = '${kind}' AND record_id = OLD.id); END`,
        );
      }
      // Manual history is outside STORAGE_TABLES but carries the same deletion boundary.
      await tx.execute('DROP TRIGGER IF EXISTS summary_manual_history_deleted');
      await tx.execute(
        `CREATE TRIGGER summary_manual_history_deleted AFTER DELETE ON manual_history_entries BEGIN DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (SELECT summary_id FROM symptom_summary_sources WHERE record_kind = 'manual_history' AND record_id = OLD.id); END`,
      );
      // Memory may be opened after history. Install its deletion guard before either can write.
      await tx.execute(
        'CREATE TABLE IF NOT EXISTS agent_memory_records (id TEXT PRIMARY KEY NOT NULL, record_json TEXT NOT NULL)',
      );
      await setupSummaryParentMutationGuards(tx);
      await setupResearchArtifactGuards(tx);
      await setupResearchInputGuards(tx);
      await tx.execute('DROP TRIGGER IF EXISTS summary_memory_deleted');
      await tx.execute(
        `CREATE TRIGGER summary_memory_deleted AFTER DELETE ON agent_memory_records BEGIN DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (SELECT summary_id FROM symptom_summary_sources WHERE record_kind = 'reviewed_memory' AND record_id = OLD.id); END`,
      );
      await tx.execute('DROP TRIGGER IF EXISTS summary_memory_changed');
      await tx.execute(`CREATE TRIGGER summary_memory_changed AFTER UPDATE ON agent_memory_records
        WHEN ${memoryContentChangedPredicate()} BEGIN
        DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (SELECT summary_id FROM symptom_summary_sources WHERE record_kind = 'reviewed_memory' AND record_id = OLD.id); END`);
      // Repair results retained by older versions when a referenced source was already deleted.
      const sourceTables = {
        ...Object.fromEntries(
          Object.entries(STORAGE_TABLES).map(([kind, value]) => [
            kind,
            value.table,
          ]),
        ),
        manual_history: 'manual_history_entries',
        reviewed_memory: 'agent_memory_records',
      };
      for (const [kind, table] of Object.entries(sourceTables)) {
        await tx.execute(
          `DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (SELECT s.summary_id FROM symptom_summary_sources s WHERE s.record_kind = ? AND NOT EXISTS (SELECT 1 FROM ${table} source WHERE source.id = s.record_id))`,
          [kind],
        );
      }
    });
  }
  return {
    async append(value) {
      await ensure();
      const serialized = JSON.stringify(value);
      if (serialized.length > 128_000 || !decodeSavedSymptomSummary(serialized))
        throw new Error('The summary cannot be saved.');
      await database.transaction(async tx => {
        const invalid = await tx.execute(
          'SELECT id FROM conversation_invalid_summaries WHERE id = ? LIMIT 1',
          [value.id],
        );
        if (invalid.rows.length)
          throw new Error('The summary was removed or its sources changed.');
        // Recheck even an idempotent retry; a quarantined result must not report a successful save.
        await assertRetainedEvidenceCurrent(tx, value.sources, manualHistory);
        const existing = await tx.execute(
          'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
          [value.id],
        );
        if (existing.rows.length) {
          if (existing.rows[0]?.result_json !== serialized)
            throw new Error('A different result already owns this summary ID.');
          return;
        }
        await tx.execute(
          'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
          [value.id, value.createdAt, value.modelName, serialized],
        );
        for (const source of value.sources) {
          if (isPeriodSummarySource(source)) {
            await appendSummaryPeriod(tx, value.id, source);
            continue;
          }
          if (
            isGeneratedSummarySource(source) ||
            isGeneratedConversationSource(source) ||
            isGeneratedResearchSource(source)
          ) {
            await tx.execute(
              'INSERT OR IGNORE INTO symptom_summary_sources (summary_id, record_kind, record_id) VALUES (?, ?, ?)',
              [value.id, source.kind, source.id],
            );
            continue;
          }
          for (const record of source.records) {
            await tx.execute(
              'INSERT OR IGNORE INTO symptom_summary_sources (summary_id, record_kind, record_id) VALUES (?, ?, ?)',
              [value.id, record.kind, record.id],
            );
          }
        }
      });
    },
    async list(before) {
      await ensure();
      // A stable cursor and fixed page size bound history reads independently of total saved runs.
      const rows = await database.execute(
        `SELECT r.id, r.created_at, r.model_name, r.result_json FROM symptom_summary_runs r WHERE (? IS NULL OR r.id < ?) AND ${visibleSummary} ORDER BY r.id DESC LIMIT 10`,
        [before ?? null, before ?? null],
      );
      return rows.rows.flatMap(row => {
        if (
          typeof row.id !== 'string' ||
          typeof row.created_at !== 'string' ||
          typeof row.model_name !== 'string'
        )
          return [];
        const saved = decodeSavedSymptomSummary(row.result_json);
        return [
          {
            id: row.id,
            createdAt: row.created_at,
            modelName: row.model_name,
            ...(saved && hasCompleteSummaryLineage(saved)
              ? {}
              : { inputLineage: 'unknown' as const }),
          },
        ];
      });
    },
    async read(id) {
      await ensure();
      const result = await database.execute(
        `SELECT r.result_json FROM symptom_summary_runs r WHERE r.id = ? AND ${visibleSummary}`,
        [id],
      );
      return decodeSavedSymptomSummary(result.rows[0]?.result_json);
    },
    async readWithStatus(id) {
      await ensure();
      const result = await database.execute(
        `SELECT r.result_json, EXISTS (SELECT 1 FROM conversation_invalid_summaries invalid WHERE invalid.id = r.id) AS invalid FROM symptom_summary_runs r WHERE r.id = ? AND ${visibleSummary}`,
        [id],
      );
      const summary = decodeSavedSymptomSummary(result.rows[0]?.result_json);
      return summary
        ? { summary, sourceChanged: result.rows[0]?.invalid === 1 }
        : null;
    },
  };
}
