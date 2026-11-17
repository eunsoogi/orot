import { assertPeriodNotRemoved } from './conversationPeriodRemoval';
import type { SqlExecutor } from '@orot/storage';
import {
  isPeriodSummarySource,
  type SavedSymptomSummary,
} from '../diseaseHypotheses/savedSummaries';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { assertSummaryPeriodCurrent } from './symptomSummaryPeriods';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';

const table = 'summary_period_policy';

/** A private, non-destructive fence: never insert legacy failures into invalid-summary
 * tables whose triggers delete descendants. Only a newly generated identity can recover. */
export async function legacySummaryPeriodAvailable(
  tx: SqlExecutor,
  summary: SavedSymptomSummary,
): Promise<boolean> {
  const exists = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
  );
  if (exists.rows.length) {
    const policy = await tx.execute(
      `SELECT status FROM ${table} WHERE summary_id = ?`,
      [summary.id],
    );
    if (policy.rows.length) return policy.rows[0]?.status === 'current';
  }
  for (const source of summary.sources) {
    if (
      !isPeriodSummarySource(source) ||
      !['measurements', 'activity'].includes(source.scope.topic)
    )
      continue;
    try {
      // The serialized scope includes ingestion cutoff. Generation mismatch is a conservative
      // fence for already deleted contributors whose old rows can no longer identify their period.
      await assertPeriodNotRemoved(tx, source);
      await assertSummaryPeriodCurrent(tx, source, true);
    } catch (error) {
      if (error instanceof RetainedSourceInvalidError) return false;
      throw error; // Operational errors must not create permanent quarantine decisions.
    }
  }
  return true;
}

/** Run after contributor triggers are upgraded, in the same schema transaction.
 * Policy rows distinguish old captures from new captures without rewriting saved content. */
export async function setupLegacySummaryPeriodQuarantine(tx: SqlExecutor) {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS ${table} (summary_id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL CHECK(status IN ('current', 'quarantined')))`,
  );
  const rows = await tx.execute(
    `SELECT r.id, r.result_json FROM symptom_summary_runs r WHERE NOT EXISTS (SELECT 1 FROM ${table} p WHERE p.summary_id = r.id)`,
  );
  for (const row of rows.rows) {
    const summary = decodeSavedSymptomSummary(row.result_json);
    if (!summary) continue; // Daily reports and unsupported legacy formats have separate readers.
    const available = await legacySummaryPeriodAvailable(tx, summary);
    await tx.execute(
      `INSERT OR IGNORE INTO ${table} (summary_id, status) VALUES (?, ?)`,
      [summary.id, available ? 'current' : 'quarantined'],
    );
  }
}

export async function markCurrentSummaryPeriodPolicy(
  tx: SqlExecutor,
  id: string,
) {
  await tx.execute(
    `INSERT INTO ${table} (summary_id, status) VALUES (?, 'current')`,
    [id],
  );
}

export const visibleLegacySummaryPeriod = `NOT EXISTS (SELECT 1 FROM ${table} policy WHERE policy.summary_id = r.id AND policy.status = 'quarantined')`;
