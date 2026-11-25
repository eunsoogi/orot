import { STORAGE_TABLES, type SqlExecutor } from '@orot/storage';
import {
  healthPeriodDeletionGuards,
  replaceHealthPeriodTrigger,
} from './healthPeriodDependencies';
import {
  jsonValueChangedPredicate,
  memoryContentChangedPredicate,
} from './memoryContentChange';
import { markerMatchesArtifactSource } from './typedDeletionMarkers';
import { periodRowReferences } from './conversationPeriodRemoval';

/** Tool-only turns need the same source invalidation as retained conversation artifacts. */
export async function setupConversationToolGuards(tx: SqlExecutor) {
  // Artifact retirement can remove many messages from one large conversation.
  // Match both exact ownership fields rather than scanning that session per message.
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS conversation_tool_events_message ON conversation_tool_events (session_id, message_id)',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_tool_dependencies (artifact_id TEXT NOT NULL, session_id TEXT NOT NULL, run_id TEXT NOT NULL, call_id TEXT NOT NULL, record_kind TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY (artifact_id, record_kind, record_id))',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_tool_periods (artifact_id TEXT NOT NULL, session_id TEXT NOT NULL, run_id TEXT NOT NULL, call_id TEXT NOT NULL, topic TEXT NOT NULL, from_key TEXT NOT NULL, to_key TEXT NOT NULL, PRIMARY KEY (artifact_id, topic, from_key, to_key))',
  );
  // Source-first lookup avoids probing dependencies for every saved call
  // while the shared protected writer is held. DELETE still fires every
  // existing per-call tombstone/lineage cleanup trigger in this transaction.
  await setupToolDependencySourceLookup(tx);
  await replaceHealthPeriodTrigger(
    tx,
    `CREATE TRIGGER tool_source_removed_manual_history AFTER DELETE ON manual_history_entries BEGIN
    DELETE FROM conversation_tool_events
    WHERE (session_id, run_id, call_id) IN (
      SELECT session_id, run_id, call_id FROM conversation_tool_dependencies
      WHERE record_kind = 'manual_history' AND record_id = OLD.id
    ); END`,
  );
  const erase = (table: string, condition: string) =>
    `DELETE FROM conversation_tool_events WHERE EXISTS (SELECT 1 FROM ${table} p WHERE p.session_id = conversation_tool_events.session_id AND p.run_id = conversation_tool_events.run_id AND p.call_id = conversation_tool_events.call_id AND (${condition}));`;
  await tx.execute(
    `CREATE TRIGGER IF NOT EXISTS conversation_tool_dependencies_removed AFTER DELETE ON conversation_tool_events BEGIN DELETE FROM conversation_tool_dependencies WHERE session_id = OLD.session_id AND run_id = OLD.run_id AND call_id = OLD.call_id; DELETE FROM conversation_tool_periods WHERE session_id = OLD.session_id AND run_id = OLD.run_id AND call_id = OLD.call_id; END`,
  );
  for (const [kind, { table }] of Object.entries(STORAGE_TABLES)) {
    const match = `p.record_kind = '${kind}' AND p.record_id = OLD.id`;
    await tx.execute(
      `CREATE TRIGGER IF NOT EXISTS tool_source_removed_${kind} AFTER DELETE ON ${table} BEGIN ${erase('conversation_tool_dependencies', match)} END`,
    );
    await tx.execute(
      `CREATE TRIGGER IF NOT EXISTS tool_source_changed_${kind} AFTER UPDATE ON ${table} WHEN OLD.id IS NOT NEW.id OR ${jsonValueChangedPredicate('OLD.payload_json', 'NEW.payload_json')} BEGIN ${erase('conversation_tool_dependencies', match)} END`,
    );
  }
  await tx.execute(
    `CREATE TRIGGER IF NOT EXISTS tool_source_removed_reviewed_memory AFTER DELETE ON agent_memory_records BEGIN ${erase('conversation_tool_dependencies', "p.record_kind = 'reviewed_memory' AND p.record_id = OLD.id")} END`,
  );
  await tx.execute(
    `CREATE TRIGGER IF NOT EXISTS tool_memory_changed AFTER UPDATE ON agent_memory_records WHEN ${memoryContentChangedPredicate()} BEGIN ${erase('conversation_tool_dependencies', "p.record_kind = 'reviewed_memory' AND p.record_id = OLD.id")} END`,
  );
  await tx.execute(
    `CREATE TRIGGER IF NOT EXISTS tool_manual_changed AFTER UPDATE ON manual_history_entries WHEN OLD.id IS NOT NEW.id OR ${jsonValueChangedPredicate('OLD.payload_json', 'NEW.payload_json')} BEGIN ${erase('conversation_tool_dependencies', "p.record_kind = 'manual_history' AND p.record_id = OLD.id")} END`,
  );
  await tx.execute(
    `CREATE TRIGGER IF NOT EXISTS tool_manual_corrected AFTER INSERT ON manual_history_entries WHEN NEW.supersedes_id IS NOT NULL BEGIN ${erase('conversation_tool_dependencies', "p.record_kind = 'manual_history' AND p.record_id = NEW.supersedes_id")} END`,
  );
  const markerMatch = (marker: string) =>
    `conversation_tool_dependencies.record_id = NEW.source_id AND conversation_tool_dependencies.record_kind NOT IN ('generated_summary', 'generated_conversation', 'generated_research') AND ${markerMatchesArtifactSource(marker, 'NEW.source_id', 'conversation_tool_dependencies', 'identity')}`;
  await tx.execute(
    `CREATE TRIGGER IF NOT EXISTS tool_marker_source_deletion_tombstones AFTER INSERT ON source_deletion_tombstones BEGIN DELETE FROM conversation_tool_events WHERE EXISTS (SELECT 1 FROM conversation_tool_dependencies WHERE session_id = conversation_tool_events.session_id AND run_id = conversation_tool_events.run_id AND call_id = conversation_tool_events.call_id AND ${markerMatch('source_deletion_tombstones')}); END`,
  );
  // Recording cascades can insert a fence for every affected typed identity. Find
  // matching calls by exact record ID, retaining the same wildcard/alias rules.
  await replaceHealthPeriodTrigger(
    tx,
    `CREATE TRIGGER tool_marker_agent_memory_removed_sources AFTER INSERT ON agent_memory_removed_sources BEGIN
      DELETE FROM conversation_tool_events WHERE (session_id, run_id, call_id) IN (
        SELECT session_id, run_id, call_id FROM conversation_tool_dependencies
        WHERE ${markerMatch('agent_memory_removed_sources')}
      ); END`,
  );
  for (const [table, guard] of Object.entries(healthPeriodDeletionGuards())) {
    const next = guard.replaceAll('OLD.', 'NEW.');
    const changed = `OLD.id IS NOT NEW.id OR ${jsonValueChangedPredicate('OLD.payload_json', 'NEW.payload_json')}`;
    const update = `((${changed}) AND ((${guard}) OR (${next}))) OR ((${guard}) AND NOT coalesce((${next}), 0))`;
    for (const [event, condition] of [
      ['INSERT', next],
      ['DELETE', guard],
      ['UPDATE', update],
    ] as const)
      await replaceHealthPeriodTrigger(
        tx,
        `CREATE TRIGGER IF NOT EXISTS tool_period_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN ${erase('conversation_tool_periods', condition)} END`,
      );
    const kinds: Record<string, string> = {
      health_observations: 'health_observation',
      medication_definitions: 'medication_definition',
      medication_assertions: 'medication_assertion',
      dose_events: 'dose_event',
      symptom_entries: 'symptom_entry',
    };
    for (const marker of [
      'source_deletion_tombstones',
      'agent_memory_removed_sources',
    ]) {
      const condition = `EXISTS (SELECT 1 FROM ${table} h WHERE ${periodRowReferences('NEW.source_id', marker, kinds[table]!)} AND (${guard.replaceAll('OLD.', 'h.')}))`;
      await replaceHealthPeriodTrigger(
        tx,
        `CREATE TRIGGER IF NOT EXISTS tool_period_${table}_${marker} AFTER INSERT ON ${marker} BEGIN ${erase('conversation_tool_periods', condition)} END`,
      );
    }
    for (const event of ['INSERT', 'UPDATE']) {
      const kind = kinds[table]!;
      const condition = `EXISTS (SELECT 1 FROM ${table} h WHERE h.id = NEW.artifact_id AND (${guard.replaceAll('OLD.', 'h.')}))`;
      await replaceHealthPeriodTrigger(
        tx,
        `CREATE TRIGGER IF NOT EXISTS tool_period_stale_${table}_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness WHEN NEW.artifact_kind = '${kind}' BEGIN ${erase('conversation_tool_periods', condition)} END`,
      );
    }
  }
  for (const event of ['INSERT', 'UPDATE'])
    await tx.execute(
      `CREATE TRIGGER IF NOT EXISTS tool_source_stale_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness BEGIN ${erase('conversation_tool_dependencies', 'p.record_kind = NEW.artifact_kind AND p.record_id = NEW.artifact_id')} END`,
    );
  for (const [table, kind] of [
    ['conversation_invalid_parents', 'generated_conversation'],
    ['conversation_invalid_summaries', 'generated_summary'],
  ] as const)
    await tx.execute(
      `CREATE TRIGGER IF NOT EXISTS tool_parent_${kind} AFTER INSERT ON ${table} BEGIN ${erase('conversation_tool_dependencies', `p.record_kind = '${kind}' AND p.record_id = NEW.id`)} END`,
    );
  await tx.execute(
    `CREATE TRIGGER IF NOT EXISTS tool_summary_changed AFTER UPDATE ON symptom_summary_runs WHEN OLD.result_json IS NOT NEW.result_json OR OLD.id IS NOT NEW.id BEGIN ${erase('conversation_tool_dependencies', "p.record_kind = 'generated_summary' AND p.record_id = OLD.id")} END`,
  );
}

/** Reorient the existing covering index atomically, without maintaining a second copy.
 * Manual history still searches both equality keys; a marker can have an unknown kind. */
async function setupToolDependencySourceLookup(tx: SqlExecutor): Promise<void> {
  const result = await tx.execute(
    'PRAGMA index_info(conversation_tool_dependency_source)',
  );
  if (
    result.rows.map(row => row.name).join(',') ===
    'record_id,record_kind,session_id,run_id,call_id'
  )
    return;
  await tx.execute('DROP INDEX IF EXISTS conversation_tool_dependency_source');
  await tx.execute(
    'CREATE INDEX conversation_tool_dependency_source ON conversation_tool_dependencies (record_id, record_kind, session_id, run_id, call_id)',
  );
}
