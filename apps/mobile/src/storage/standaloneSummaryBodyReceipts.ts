import type { SqlExecutor } from '@orot/storage';
import {
  healthPeriodDeletionGuards,
  replaceHealthPeriodTrigger,
} from './healthPeriodDependencies';
import {
  isPeriodSummarySource,
  type SavedSymptomSummary,
} from '../diseaseHypotheses/savedSummaries';

/** No legacy backfill. A fresh exact body receives a content-free witness only
 * inside its protected append transaction. Raw row edits cannot re-attest. */
export async function commitStandaloneSummaryBody(
  tx: SqlExecutor,
  summary: SavedSymptomSummary,
) {
  if (
    summary.inputLineage !== 'complete' ||
    summary.analysis.presentation !== 'symptom_summary' ||
    summary.sources.length === 0 ||
    !summary.sources.every(
      source =>
        isPeriodSummarySource(source) && source.scope.topic === 'measurements',
    )
  )
    return;
  await tx.execute(
    'INSERT INTO standalone_summary_body_receipts (summary_id) VALUES (?)',
    [summary.id],
  );
}

export async function setupStandaloneSummaryBodyReceipts(tx: SqlExecutor) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS standalone_summary_body_receipts (
    summary_id TEXT PRIMARY KEY NOT NULL,
    source_revision INTEGER NOT NULL DEFAULT 0 CHECK(source_revision IN (0, 1))
  ) WITHOUT ROWID`);
  for (const [event, id, when] of [
    ['INSERT', 'NEW.id', ''],
    ['DELETE', 'OLD.id', ''],
    [
      'UPDATE',
      'OLD.id, NEW.id',
      'WHEN OLD.id IS NOT NEW.id OR OLD.created_at IS NOT NEW.created_at OR OLD.model_name IS NOT NEW.model_name OR OLD.result_json IS NOT NEW.result_json',
    ],
  ] as const) {
    // INSERT clears an old witness even when REPLACE omits the DELETE trigger.
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS standalone_body_${event.toLowerCase()}
      AFTER ${event} ON symptom_summary_runs ${when} BEGIN
      INSERT INTO conversation_invalid_summaries (id)
      SELECT b.summary_id FROM standalone_summary_body_receipts b WHERE b.summary_id IN (${id})
        AND NOT EXISTS (SELECT 1 FROM conversation_invalid_summaries i WHERE i.id = b.summary_id);
      DELETE FROM standalone_summary_body_receipts WHERE summary_id IN (${id}); END`);
  }
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS standalone_body_source_reason_removed
    AFTER DELETE ON conversation_invalid_summaries BEGIN
    UPDATE standalone_summary_body_receipts SET source_revision = 0 WHERE summary_id = OLD.id; END`);

  // A same-record numeric correction cannot change owner, provenance, review
  // state, time window, or identity. Do not attest general staleness/removal.
  const period = healthPeriodDeletionGuards('measurements').health_observations;
  const amountCorrection = `OLD.id IS NEW.id AND OLD.effective_at IS NEW.effective_at AND
      CASE WHEN json_valid(OLD.payload_json) AND json_valid(NEW.payload_json) THEN
        json_extract(OLD.payload_json, '$.value.kind') = 'quantity'
        AND json_type(OLD.payload_json, '$.value.amount') IN ('integer', 'real')
        AND json_type(NEW.payload_json, '$.value.amount') IN ('integer', 'real')
        AND json_extract(OLD.payload_json, '$.value.amount') IS NOT json_extract(NEW.payload_json, '$.value.amount')
        AND json_remove(OLD.payload_json, '$.value.amount') IS json_remove(NEW.payload_json, '$.value.amount')
      ELSE 0 END`;
  await replaceHealthPeriodTrigger(
    tx,
    `CREATE TRIGGER IF NOT EXISTS standalone_body_numeric_source_revised
    BEFORE UPDATE ON health_observations
    WHEN ${amountCorrection} BEGIN
    UPDATE standalone_summary_body_receipts SET source_revision = 1
      WHERE summary_id IN (
        SELECT p.summary_id FROM symptom_summary_periods p WHERE ${period}
      ) AND NOT EXISTS (
        SELECT 1 FROM conversation_invalid_summaries i WHERE i.id = standalone_summary_body_receipts.summary_id
      );
    END`,
  );
  const retire = (query: string) =>
    `UPDATE standalone_summary_body_receipts SET source_revision = 0
       WHERE source_revision = 1 AND summary_id IN (${query});`;
  const oldPeriods = `SELECT p.summary_id FROM symptom_summary_periods p WHERE ${period}`;
  const newPeriods = oldPeriods.replaceAll('OLD.', 'NEW.');
  await replaceHealthPeriodTrigger(
    tx,
    `CREATE TRIGGER IF NOT EXISTS standalone_body_other_source_change
    BEFORE UPDATE ON health_observations
    WHEN (OLD.id IS NOT NEW.id OR OLD.effective_at IS NOT NEW.effective_at OR OLD.payload_json IS NOT NEW.payload_json)
      AND NOT (${amountCorrection}) BEGIN
    ${retire(`${oldPeriods} UNION ${newPeriods}`)} END`,
  );
  await replaceHealthPeriodTrigger(
    tx,
    `CREATE TRIGGER IF NOT EXISTS standalone_body_source_reinserted
    AFTER INSERT ON health_observations BEGIN ${retire(newPeriods)} END`,
  );
  for (const event of ['INSERT', 'UPDATE']) {
    const stalePeriods = `SELECT p.summary_id FROM symptom_summary_periods p
      JOIN health_observations h ON h.id = NEW.artifact_id
      WHERE ${period.replaceAll('OLD.', 'h.')}`;
    await replaceHealthPeriodTrigger(
      tx,
      `CREATE TRIGGER IF NOT EXISTS standalone_body_source_stale_${event.toLowerCase()}
      AFTER ${event} ON transcript_artifact_staleness WHEN NEW.artifact_kind = 'health_observation' BEGIN
      ${retire(stalePeriods)} END`,
    );
  }
}
