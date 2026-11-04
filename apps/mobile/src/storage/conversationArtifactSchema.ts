import { STORAGE_TABLES, type SqlExecutor } from '@orot/storage';
import { ensureHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import { healthPeriodDeletionGuards } from './healthPeriodDependencies';
import { periodRowReferences } from './conversationPeriodRemoval';
import {
  jsonValueChangedPredicate,
  memoryContentChangedPredicate,
} from './memoryContentChange';

/** Install dependency cleanup in the same encrypted store as records and retained output. */
export async function setupConversationArtifactSchema(tx: SqlExecutor) {
  await ensureHealthContextGeneration(tx);
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_artifact_generation (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation INTEGER NOT NULL)',
  );
  await tx.execute(
    'INSERT OR IGNORE INTO conversation_artifact_generation VALUES (1, 0)',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_artifact_sessions (id TEXT PRIMARY KEY NOT NULL, generation INTEGER NOT NULL)',
  );
  const columns = await tx.execute(
    'PRAGMA table_info(conversation_artifact_sessions)',
  );
  if (!columns.rows.some(row => row.name === 'hidden'))
    await tx.execute(
      'ALTER TABLE conversation_artifact_sessions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0',
    );
  if (!columns.rows.some(row => row.name === 'version'))
    await tx.execute(
      'ALTER TABLE conversation_artifact_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 0',
    );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_artifact_removed_sessions (id TEXT PRIMARY KEY NOT NULL)',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_artifacts (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, created_at TEXT NOT NULL, result_json TEXT NOT NULL)',
  );
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS conversation_artifacts_order ON conversation_artifacts (session_id, created_at DESC, id DESC)',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_artifact_sources (artifact_id TEXT NOT NULL, record_kind TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY (artifact_id, record_kind, record_id))',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_artifact_periods (artifact_id TEXT NOT NULL, topic TEXT NOT NULL, from_key TEXT NOT NULL, to_key TEXT NOT NULL, PRIMARY KEY (artifact_id, topic, from_key, to_key))',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS agent_memory_records (id TEXT PRIMARY KEY NOT NULL, record_json TEXT NOT NULL)',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS agent_memory_removed_sources (source_id TEXT PRIMARY KEY NOT NULL)',
  );
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN
    INSERT OR IGNORE INTO conversation_artifact_removed_sessions (id) VALUES (OLD.id);
    DELETE FROM conversation_artifacts WHERE session_id = OLD.id; END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_artifact_removed AFTER DELETE ON conversation_artifacts BEGIN
    DELETE FROM conversation_artifact_sources WHERE artifact_id = OLD.id;
    DELETE FROM conversation_artifact_periods WHERE artifact_id = OLD.id; END`);
  for (const [kind, { table }] of Object.entries(STORAGE_TABLES)) {
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_source_removed_${kind} AFTER DELETE ON ${table} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT artifact_id FROM conversation_artifact_sources WHERE record_kind = '${kind}' AND record_id = OLD.id); END`);
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_source_changed_${kind} AFTER UPDATE ON ${table}
      WHEN OLD.id IS NOT NEW.id OR ${jsonValueChangedPredicate('OLD.payload_json', 'NEW.payload_json')} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT artifact_id FROM conversation_artifact_sources WHERE record_kind = '${kind}' AND record_id = OLD.id); END`);
  }
  for (const [kind, table] of [
    ['manual_history', 'manual_history_entries'],
    ['reviewed_memory', 'agent_memory_records'],
  ] as const) {
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_source_removed_${kind} AFTER DELETE ON ${table} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT artifact_id FROM conversation_artifact_sources WHERE record_kind = '${kind}' AND record_id = OLD.id); END`);
  }
  // Vector or ranking changes leave source content unchanged; text or metadata changes invalidate it permanently.
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_memory_changed AFTER UPDATE ON agent_memory_records
    WHEN ${memoryContentChangedPredicate()} BEGIN
    DELETE FROM conversation_artifacts WHERE id IN (SELECT artifact_id FROM conversation_artifact_sources WHERE record_kind = 'reviewed_memory' AND record_id = OLD.id); END`);
  for (const table of [
    'source_deletion_tombstones',
    'agent_memory_removed_sources',
  ]) {
    const guards = healthPeriodDeletionGuards();
    const referencesMarker = periodRowReferences('NEW.source_id');
    const affectedRows = Object.keys(guards)
      .map(name => `EXISTS (SELECT 1 FROM ${name} h WHERE ${referencesMarker})`)
      .join(' OR ');
    const affectedPeriods = Object.entries(guards)
      .map(
        ([name, guard]) =>
          `DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE EXISTS (SELECT 1 FROM ${name} h WHERE ${referencesMarker} AND (${guard.replaceAll('OLD.', 'h.')})));`,
      )
      .join('\n');
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_logical_removal_${table} AFTER INSERT ON ${table} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT artifact_id FROM conversation_artifact_sources WHERE record_id = NEW.source_id);
      ${affectedPeriods}
      UPDATE health_context_generation SET mutations = mutations + 1, deletions = deletions + 1 WHERE singleton = 1 AND (${affectedRows}); END`);
  }
  for (const [table, guard] of Object.entries(healthPeriodDeletionGuards())) {
    const next = guard.replaceAll('OLD.', 'NEW.');
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_period_added_${table} AFTER INSERT ON ${table} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE ${next}); END`);
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_period_changed_${table} AFTER UPDATE ON ${table}
      WHEN OLD.id IS NOT NEW.id OR ${jsonValueChangedPredicate('OLD.payload_json', 'NEW.payload_json')} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE (${guard}) OR (${next})); END`);
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_period_removed_${table} AFTER DELETE ON ${table} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE ${guard}); END`);
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_period_moved_${table} AFTER UPDATE ON ${table} BEGIN
      DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE (${guard}) AND NOT coalesce((${next}), 0)); END`);
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
      await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_period_stale_${table}_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness WHEN NEW.artifact_kind = '${kind}' BEGIN
        DELETE FROM conversation_artifacts WHERE id IN (SELECT p.artifact_id FROM conversation_artifact_periods p WHERE EXISTS (SELECT 1 FROM ${table} h WHERE h.id = NEW.artifact_id AND (${guard.replaceAll('OLD.', 'h.')}))); END`);
    }
  }
}
