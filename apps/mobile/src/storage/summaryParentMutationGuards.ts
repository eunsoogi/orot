import { STORAGE_TABLES, type SqlExecutor } from '@orot/storage';
import { healthPeriodDeletionGuards } from './healthPeriodDependencies';
import {
  jsonValueChangedPredicate,
  memoryContentChangedPredicate,
} from './memoryContentChange';
import { setupVisitQuestionGeneratedSourceGuards } from './visitQuestionGeneratedSources';
import { generatedSummaryDescendants } from './generatedArtifactDescendants';
import { completeSummaryDeletion } from './summaryDeletionPolicy';

// Outer UPSERT conflict handling overrides OR IGNORE inside triggers; filter duplicates explicitly.
const mark = (
  select: string,
) => `INSERT INTO conversation_invalid_summaries (id)
  SELECT DISTINCT candidate.id FROM (${select}) candidate
  WHERE NOT EXISTS (SELECT 1 FROM conversation_invalid_summaries existing WHERE existing.id = candidate.id);`;

/** Remember source revisions that changed even if a later edit restores the old value. */
export async function setupSummaryParentMutationGuards(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_invalid_summaries (id TEXT PRIMARY KEY NOT NULL)',
  );
  await setupVisitQuestionGeneratedSourceGuards(tx);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_revision_changed AFTER UPDATE ON symptom_summary_runs
    WHEN OLD.id IS NOT NEW.id OR OLD.created_at IS NOT NEW.created_at OR OLD.model_name IS NOT NEW.model_name OR OLD.result_json IS NOT NEW.result_json BEGIN
    ${mark('SELECT OLD.id AS id')} END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_removed_fence AFTER DELETE ON symptom_summary_runs BEGIN
    ${mark('SELECT OLD.id AS id')} END`);
  // Compute all summary descendants in one statement even when recursive triggers are disabled.
  const descendants = generatedSummaryDescendants('generated_summary');
  await tx.execute(
    'DROP TRIGGER IF EXISTS summary_generated_parent_invalidated',
  );
  await tx.execute(`CREATE TRIGGER summary_generated_parent_invalidated AFTER INSERT ON conversation_invalid_summaries BEGIN
    DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (${generatedSummaryDescendants('generated_summary', 'NEW.id')}); END`);
  await tx.execute('DROP TRIGGER IF EXISTS summary_generated_parent_removed');
  await tx.execute(`CREATE TRIGGER summary_generated_parent_removed AFTER DELETE ON symptom_summary_runs BEGIN
    DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (${descendants}); END`);
  await tx.execute('DROP TRIGGER IF EXISTS summary_generated_parent_changed');
  await tx.execute(`CREATE TRIGGER summary_generated_parent_changed AFTER UPDATE ON symptom_summary_runs
    WHEN OLD.id IS NOT NEW.id OR OLD.created_at IS NOT NEW.created_at OR OLD.model_name IS NOT NEW.model_name OR OLD.result_json IS NOT NEW.result_json BEGIN
    DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (${descendants}); END`);
  for (const [kind, { table }] of Object.entries(STORAGE_TABLES)) {
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_source_changed_${kind} AFTER UPDATE ON ${table}
      WHEN OLD.id IS NOT NEW.id OR ${jsonValueChangedPredicate('OLD.payload_json', 'NEW.payload_json')} BEGIN
      ${mark(`SELECT summary_id AS id FROM symptom_summary_sources WHERE record_kind = '${kind}' AND record_id = OLD.id`)} END`);
  }
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_memory_changed AFTER UPDATE ON agent_memory_records
    WHEN ${memoryContentChangedPredicate()} BEGIN
    ${mark("SELECT summary_id AS id FROM symptom_summary_sources WHERE record_kind = 'reviewed_memory' AND record_id = OLD.id")} END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_manual_corrected AFTER INSERT ON manual_history_entries WHEN NEW.supersedes_id IS NOT NULL BEGIN
    ${mark("SELECT summary_id AS id FROM symptom_summary_sources WHERE record_kind = 'manual_history' AND record_id = NEW.supersedes_id")} END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_manual_changed AFTER UPDATE ON manual_history_entries
    WHEN OLD.id IS NOT NEW.id OR ${jsonValueChangedPredicate('OLD.payload_json', 'NEW.payload_json')} BEGIN
    ${mark("SELECT summary_id AS id FROM symptom_summary_sources WHERE record_kind = 'manual_history' AND record_id = OLD.id")} END`);
  for (const [table, guard] of Object.entries(healthPeriodDeletionGuards())) {
    const next = guard.replaceAll('OLD.', 'NEW.');
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_period_added_${table} AFTER INSERT ON ${table} BEGIN
      ${mark(`SELECT p.summary_id AS id FROM symptom_summary_periods p WHERE ${next}`)} END`);
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_period_changed_${table} AFTER UPDATE ON ${table}
      WHEN OLD.id IS NOT NEW.id OR ${jsonValueChangedPredicate('OLD.payload_json', 'NEW.payload_json')} BEGIN
      ${mark(`SELECT p.summary_id AS id FROM symptom_summary_periods p WHERE (${guard}) OR (${next})`)} END`);
    const kind = (
      {
        health_observations: 'health_observation',
        medication_definitions: 'medication_definition',
        medication_assertions: 'medication_assertion',
        dose_events: 'dose_event',
        symptom_entries: 'symptom_entry',
      } as Record<string, string>
    )[table]!;
    for (const event of ['INSERT', 'UPDATE'])
      await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_period_stale_${table}_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness WHEN NEW.artifact_kind = '${kind}' BEGIN
        ${mark(`SELECT p.summary_id AS id FROM symptom_summary_periods p JOIN ${table} h ON h.id = NEW.artifact_id WHERE ${guard.replaceAll('OLD.', 'h.')}`)} END`);
  }
  for (const event of ['INSERT', 'UPDATE'])
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_parent_source_stale_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness BEGIN
      ${mark('SELECT summary_id AS id FROM symptom_summary_sources WHERE record_kind = NEW.artifact_kind AND record_id = NEW.artifact_id')} END`);
}
