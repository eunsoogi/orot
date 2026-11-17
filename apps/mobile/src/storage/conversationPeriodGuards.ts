import type { SqlExecutor } from '@orot/storage';
import {
  healthPeriodDeletionGuards,
  replaceHealthPeriodTrigger,
} from './healthPeriodDependencies';
import { jsonValueChangedPredicate } from './memoryContentChange';

/** Reinstall contributor fences when opening both new databases and restored older schemas. */
export async function setupConversationPeriodGuards(tx: SqlExecutor) {
  const periodTrigger = replaceHealthPeriodTrigger.bind(null, tx);
  for (const [table, guard] of Object.entries(healthPeriodDeletionGuards())) {
    const next = guard.replaceAll('OLD.', 'NEW.');
    await periodTrigger(
      `CREATE TRIGGER IF NOT EXISTS conversation_period_added_${table} AFTER INSERT ON ${table} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE ${next}); END`,
    );
    await periodTrigger(
      `CREATE TRIGGER IF NOT EXISTS conversation_period_changed_${table} AFTER UPDATE ON ${table}
      WHEN OLD.id IS NOT NEW.id OR ${jsonValueChangedPredicate('OLD.payload_json', 'NEW.payload_json')} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE (${guard}) OR (${next})); END`,
    );
    await periodTrigger(
      `CREATE TRIGGER IF NOT EXISTS conversation_period_removed_${table} AFTER DELETE ON ${table} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE ${guard}); END`,
    );
    await periodTrigger(
      `CREATE TRIGGER IF NOT EXISTS conversation_period_moved_${table} AFTER UPDATE ON ${table} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE (${guard}) AND NOT coalesce((${next}), 0)); END`,
    );
    const kind = (
      {
        health_observations: 'health_observation',
        medication_definitions: 'medication_definition',
        medication_assertions: 'medication_assertion',
        dose_events: 'dose_event',
        symptom_entries: 'symptom_entry',
      } as Record<string, string>
    )[table]!;
    for (const event of ['INSERT', 'UPDATE']) {
      // Correction can invalidate a contributor without removing its stored row.
      await periodTrigger(
        `CREATE TRIGGER IF NOT EXISTS conversation_period_stale_${table}_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness WHEN NEW.artifact_kind = '${kind}' BEGIN
        DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE EXISTS (SELECT 1 FROM ${table} h WHERE h.id = NEW.artifact_id AND (${guard.replaceAll('OLD.', 'h.')}))); END`,
      );
    }
  }
}
