import { createManualHistoryRepository, type SqlDatabase } from '@orot/storage';
import {
  DailyReportIdentitySchema,
  type DailyReportIdentity,
} from '@orot/domain';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import {
  ensureHealthContextGeneration,
  readHealthContextGeneration,
} from '../healthEvidence/healthContext/generation';
import { createSymptomSummaryStorage } from './symptomSummaryStorage';
import { assertRetainedRecordsCurrent } from './retainedRecordFreshness';
import { validateDailyReportCompletion } from './dailyReportValidation';
import { visibleSummary } from './symptomSummaryQuarantine';
import { parseDailyReportLineage } from './dailyReportLineage';
import {
  dailyReportSourcesChanged,
  invalidateDailyReportRun,
  invalidDailyReportStatus,
} from './dailyReportInvalidation';
import type { DailyReportSave } from './dailyReportStorageTypes';
import {
  checkDailyReportSaveCancellation,
  dailyReportSaveFailure,
} from './dailyReportSaveCancellation';
import type { DailyReportSaveStatus } from './dailyReportSaveCancellation';
export type {
  DailyReportLineage,
  DailyReportSave,
} from './dailyReportStorageTypes';
/** The same encrypted summary database serializes both entry points and all revision changes. */
export function createDailyReportStorage(database: SqlDatabase) {
  const summaries = createSymptomSummaryStorage(database);
  const manualHistory = createManualHistoryRepository(database);
  let ready: Promise<void> | undefined;
  const ensure = () =>
    (ready ??= (async () => {
      await summaries.list();
      await database.transaction(async tx => {
        await ensureHealthContextGeneration(tx);
      });
    })().catch(error => {
      ready = undefined;
      throw error;
    }));
  async function lookup(identity: DailyReportIdentity) {
    const parsed = DailyReportIdentitySchema.safeParse(identity);
    if (!parsed.success) return { status: 'error' as const };
    try {
      await ensure();
      let value: unknown;
      await database.transaction(async tx => {
        const head = (
          await tx.execute(
            'SELECT active_run_id, revision, deleted FROM daily_report_heads WHERE identity_key = ?',
            [parsed.data.key],
          )
        ).rows[0];
        if (!head) {
          value = { status: 'missing' };
          return;
        }
        if (head.deleted === 1 || typeof head.active_run_id !== 'string') {
          value = { status: 'deleted' };
          return;
        }
        const row = (
          await tx.execute(
            `SELECT r.result_json, EXISTS (SELECT 1 FROM conversation_invalid_summaries i WHERE i.id = r.id) AS invalid FROM symptom_summary_runs r WHERE r.id = ? AND ${visibleSummary}`,
            [head.active_run_id],
          )
        ).rows[0];
        if (!row || typeof row.result_json !== 'string') {
          value = { status: 'deleted' };
          return;
        }
        const saved = JSON.parse(row.result_json);
        const checked = validateDailyReportCompletion(saved.context, {
          status: 'completed',
          report: saved.report,
        });
        const lineage =
          checked && parseDailyReportLineage(checked.context, saved.lineage);
        if (
          !checked ||
          !lineage ||
          checked.context.identity.key !== parsed.data.key
        ) {
          value = { status: 'error' };
          return;
        }
        const sourceChanged = await dailyReportSourcesChanged(
          tx,
          row.invalid === 1,
          lineage,
          manualHistory,
        );
        if (sourceChanged) {
          value = {
            status: 'stale',
            runId: head.active_run_id,
            revision: head.revision,
          };
          return;
        }
        value = {
          status: 'saved',
          runId: head.active_run_id,
          revision: head.revision,
          lineage,
          ...checked,
        };
      });
      return value as
        | { status: 'missing' | 'deleted' | 'error' }
        | { status: 'stale'; runId: string; revision: number }
        | {
            status: 'saved';
            runId: string;
            revision: number;
            lineage: import('./dailyReportStorageTypes').DailyReportLineage[];
            context: NonNullable<
              ReturnType<typeof validateDailyReportCompletion>
            >['context'];
            report: NonNullable<
              ReturnType<typeof validateDailyReportCompletion>
            >['report'];
          };
    } catch {
      return { status: 'error' as const };
    }
  }

  async function save(
    input: DailyReportSave,
    signal?: AbortSignal,
  ): Promise<{ status: DailyReportSaveStatus }> {
    const checked = validateDailyReportCompletion(input.context, input.result);
    if (!checked || !input.runId.trim()) return { status: 'error' as const };
    if (!parseDailyReportLineage(checked.context, input.lineage))
      return { status: 'error' as const };
    const stored = JSON.stringify({
      inputLineage: 'complete',
      ...checked,
      lineage: input.lineage,
    });
    if (stored.length > 128_000) return { status: 'error' as const };
    try {
      await ensure();
      let status: 'saved' | 'reused' | 'stale' | 'deleted' = 'stale';
      await database.transaction(async tx => {
        checkDailyReportSaveCancellation(signal);
        const invalid = await tx.execute(
          'SELECT id FROM conversation_invalid_summaries WHERE id = ?',
          [input.runId],
        );
        if (invalid.rows.length) {
          status = await invalidDailyReportStatus(tx, input.runId);
          return;
        }
        // Direct source validation runs inside the same write transaction as the active pointer.
        const records = input.lineage.map(item => ({
          kind: item.kind,
          id: item.localId,
          revision: item.revision,
        }));
        await assertRetainedRecordsCurrent(tx, records, manualHistory);
        const existing = (
          await tx.execute(
            'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
            [input.runId],
          )
        ).rows[0];
        const prior = (
          await tx.execute(
            'SELECT identity_key FROM daily_report_revisions WHERE run_id = ?',
            [input.runId],
          )
        ).rows[0];
        const head = (
          await tx.execute(
            'SELECT active_run_id, revision, deleted FROM daily_report_heads WHERE identity_key = ?',
            [checked.context.identity.key],
          )
        ).rows[0];
        if (existing || prior) {
          if (
            typeof existing?.result_json === 'string' &&
            stableJson(JSON.parse(existing.result_json)) ===
              stableJson(JSON.parse(stored)) &&
            prior?.identity_key === checked.context.identity.key
          )
            status = head?.active_run_id === input.runId ? 'reused' : 'stale';
          else if (!existing && prior) status = 'deleted';
          else throw new Error('Run identity conflict.');
          return;
        }
        const generation = await readHealthContextGeneration(tx);
        if (
          generation.mutationGeneration !==
            checked.context.sourceSnapshot.mutationGeneration ||
          generation.deletionGeneration !==
            checked.context.sourceSnapshot.deletionGeneration
        )
          return;
        if (input.mode.kind === 'initial' && head) {
          status = head.deleted === 1 ? 'deleted' : 'stale';
          return;
        }
        if (
          input.mode.kind === 'revise' &&
          (!head || (head.active_run_id ?? null) !== input.mode.expectedRunId)
        )
          return;
        const revision = head ? Number(head.revision) + 1 : 1;
        await tx.execute(
          'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
          [
            input.runId,
            checked.report.generatedAt,
            checked.context.provider.modelId,
            stored,
          ],
        );
        for (const item of input.lineage)
          await tx.execute(
            'INSERT OR IGNORE INTO symptom_summary_sources (summary_id, record_kind, record_id) VALUES (?, ?, ?)',
            [input.runId, item.kind, item.localId],
          );
        await tx.execute(
          'INSERT INTO daily_report_revisions (identity_key, revision, run_id) VALUES (?, ?, ?)',
          [checked.context.identity.key, revision, input.runId],
        );
        await tx.execute(
          'INSERT INTO daily_report_heads (identity_key, active_run_id, revision, deleted) VALUES (?, ?, ?, 0) ON CONFLICT(identity_key) DO UPDATE SET active_run_id = excluded.active_run_id, revision = excluded.revision, deleted = 0',
          [checked.context.identity.key, input.runId, revision],
        );
        // Downstream saved artifacts must not keep a superseded active revision alive.
        if (typeof head?.active_run_id === 'string')
          await invalidateDailyReportRun(tx, head.active_run_id);
        checkDailyReportSaveCancellation(signal);
        status = 'saved';
      });
      return { status };
    } catch (error) {
      return { status: dailyReportSaveFailure(error) };
    }
  }
  return { lookup, save };
}
