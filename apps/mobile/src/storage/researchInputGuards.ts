import { STORAGE_TABLES, type SqlExecutor } from '@orot/storage';
import { healthPeriodDeletionGuards } from './healthPeriodDependencies';
import { memoryContentChangedPredicate } from './memoryContentChange';

/** Remove generated research when any input changes; no copied private text survives its source. */
export async function setupResearchInputGuards(tx: SqlExecutor) {
  const result = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  const present = new Set(result.rows.map(row => row.name));
  if (
    !present.has('research_artifacts') ||
    !present.has('research_artifact_sources') ||
    !present.has('research_artifact_periods')
  )
    return;
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS research_inputs_removed AFTER DELETE ON research_artifacts BEGIN
    DELETE FROM research_artifact_sources WHERE artifact_id = OLD.id;
    DELETE FROM research_artifact_periods WHERE artifact_id = OLD.id; END`);
  const sources: Array<[string, string, string]> = [
    ...Object.entries(STORAGE_TABLES).map(
      ([kind, value]) =>
        [kind, value.table, 'payload_json'] as [string, string, string],
    ),
    ['manual_history', 'manual_history_entries', 'payload_json'],
    ['reviewed_memory', 'agent_memory_records', 'record_json'],
    ['generated_summary', 'symptom_summary_runs', 'result_json'],
    ['generated_conversation', 'conversation_artifacts', 'result_json'],
  ];
  for (const [kind, table, column] of sources) {
    if (!present.has(table)) continue;
    for (const event of ['DELETE', 'UPDATE'] as const) {
      const name = `research_input_${kind}_${event.toLowerCase()}`;
      await tx.execute(`DROP TRIGGER IF EXISTS ${name}`);
      const changed =
        table === 'agent_memory_records'
          ? memoryContentChangedPredicate()
          : table === 'symptom_summary_runs'
            ? 'OLD.created_at IS NOT NEW.created_at OR OLD.model_name IS NOT NEW.model_name OR OLD.result_json IS NOT NEW.result_json'
            : table === 'conversation_artifacts'
              ? 'OLD.session_id IS NOT NEW.session_id OR OLD.created_at IS NOT NEW.created_at OR OLD.result_json IS NOT NEW.result_json'
              : `OLD.${column} IS NOT NEW.${column}`;
      const when =
        event === 'UPDATE' ? `WHEN OLD.id IS NOT NEW.id OR ${changed}` : '';
      await tx.execute(`CREATE TRIGGER ${name} AFTER ${event} ON ${table} ${when} BEGIN
        DELETE FROM research_artifacts WHERE id IN (SELECT artifact_id FROM research_artifact_sources WHERE record_kind = '${kind}' AND record_id = OLD.id); END`);
    }
  }
  if (present.has('manual_history_entries'))
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS research_input_manual_corrected AFTER INSERT ON manual_history_entries WHEN NEW.supersedes_id IS NOT NULL BEGIN
      DELETE FROM research_artifacts WHERE id IN (SELECT artifact_id FROM research_artifact_sources WHERE record_kind = 'manual_history' AND record_id = NEW.supersedes_id); END`);
  for (const table of [
    'source_deletion_tombstones',
    'agent_memory_removed_sources',
  ]) {
    if (!present.has(table)) continue;
    await tx.execute(`DROP TRIGGER IF EXISTS research_${table}_removed`);
    await tx.execute(`CREATE TRIGGER research_${table}_removed AFTER INSERT ON ${table} BEGIN
      DELETE FROM research_artifacts WHERE id IN (SELECT artifact_id FROM research_artifact_sources WHERE record_id = NEW.source_id AND record_kind NOT IN ('generated_summary', 'generated_conversation', 'generated_research')); END`);
  }
  for (const [table, kind] of [
    ['conversation_invalid_summaries', 'generated_summary'],
    ['conversation_invalid_parents', 'generated_conversation'],
  ] as const) {
    if (!present.has(table)) continue;
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS research_${table}_invalidated AFTER INSERT ON ${table} BEGIN
      DELETE FROM research_artifacts WHERE id IN (SELECT artifact_id FROM research_artifact_sources WHERE record_kind = '${kind}' AND record_id = NEW.id); END`);
  }
  for (const [table, oldGuard] of Object.entries(
    healthPeriodDeletionGuards(),
  )) {
    if (!present.has(table)) continue;
    const newGuard = oldGuard.replaceAll('OLD.', 'NEW.');
    for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const name = `research_period_${table}_${event.toLowerCase()}`;
      await tx.execute(`DROP TRIGGER IF EXISTS ${name}`);
      const guard =
        event === 'INSERT'
          ? newGuard
          : event === 'DELETE'
            ? oldGuard
            : `(${oldGuard}) OR (${newGuard})`;
      await tx.execute(`CREATE TRIGGER ${name} AFTER ${event} ON ${table} BEGIN
        DELETE FROM research_artifacts WHERE id IN (SELECT p.artifact_id FROM research_artifact_periods p WHERE ${guard}); END`);
    }
  }
  if (present.has('transcript_artifact_staleness')) {
    for (const event of ['INSERT', 'UPDATE'] as const) {
      await tx.execute(`CREATE TRIGGER IF NOT EXISTS research_input_stale_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness BEGIN
        DELETE FROM research_artifacts WHERE id IN (SELECT artifact_id FROM research_artifact_sources WHERE record_kind = NEW.artifact_kind AND record_id = NEW.artifact_id); END`);
    }
    for (const [table, guard] of Object.entries(healthPeriodDeletionGuards())) {
      if (!present.has(table)) continue;
      const kind = (
        {
          health_observations: 'health_observation',
          medication_definitions: 'medication_definition',
          medication_assertions: 'medication_assertion',
          dose_events: 'dose_event',
          symptom_entries: 'symptom_entry',
        } as Record<string, string>
      )[table]!;
      for (const event of ['INSERT', 'UPDATE'] as const)
        await tx.execute(`CREATE TRIGGER IF NOT EXISTS research_period_stale_${table}_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness WHEN NEW.artifact_kind = '${kind}' BEGIN
          DELETE FROM research_artifacts WHERE id IN (SELECT p.artifact_id FROM research_artifact_periods p JOIN ${table} h ON h.id = NEW.artifact_id WHERE ${guard.replaceAll('OLD.', 'h.')}); END`);
    }
  }
}
