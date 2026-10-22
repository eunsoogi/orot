import { localQueryTimestampKey, type SqlExecutor } from '@orot/storage';
import type { VisitQuestionHealthContextSource } from '@orot/domain';
import { ensureHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import {
  healthPeriodDeletionGuards,
  healthPeriodDependencyId,
} from './healthPeriodDependencies';

/** Install on every database opening, including restored backups, before health mutations can occur. */
export async function setupVisitQuestionPeriods(tx: SqlExecutor) {
  await ensureHealthContextGeneration(tx);
  // These are the existing memory adapter's tables, not another memory store.
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS agent_memory_records (id TEXT PRIMARY KEY NOT NULL, record_json TEXT NOT NULL)',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS agent_memory_removed_sources (source_id TEXT PRIMARY KEY NOT NULL)',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS visit_question_periods (question_id TEXT NOT NULL, topic TEXT NOT NULL, from_key TEXT NOT NULL, to_key TEXT NOT NULL, dependency_id TEXT NOT NULL, PRIMARY KEY(question_id, topic, from_key, to_key))',
  );
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS visit_question_period_scope ON visit_question_periods (topic, from_key, to_key)',
  );
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS visit_question_period_question_deleted AFTER DELETE ON visit_questions BEGIN
    DELETE FROM agent_memory_records WHERE json_extract(record_json, '$.meta.memoryKey') = 'visit-question-review:' || json_extract(OLD.payload_json, '$.appointmentId');
    DELETE FROM visit_question_periods WHERE question_id = OLD.id; END`);
  for (const [table, guard] of Object.entries(healthPeriodDeletionGuards())) {
    const remove = (condition: string) => `
      INSERT OR IGNORE INTO agent_memory_removed_sources (source_id) SELECT p.dependency_id FROM visit_question_periods p WHERE ${condition};
      DELETE FROM visit_questions WHERE id IN (SELECT p.question_id FROM visit_question_periods p WHERE ${condition});`;
    await tx.execute(
      `CREATE TRIGGER IF NOT EXISTS visit_question_period_deleted_${table} AFTER DELETE ON ${table} BEGIN ${remove(guard)} END`,
    );
    const next = guard.replaceAll('OLD.', 'NEW.');
    await tx.execute(
      `CREATE TRIGGER IF NOT EXISTS visit_question_period_moved_${table} AFTER UPDATE ON ${table} BEGIN ${remove(`(${guard}) AND NOT coalesce((${next}), 0)`)} END`,
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
    // Transcript corrections invalidate an original without deleting its health row.
    const stale = `EXISTS (SELECT 1 FROM ${table} h WHERE h.id = NEW.artifact_id AND (${guard.replaceAll('OLD.', 'h.')}))`;
    for (const event of ['INSERT', 'UPDATE']) {
      await tx.execute(
        `CREATE TRIGGER IF NOT EXISTS visit_question_period_stale_${table}_${event.toLowerCase()} AFTER ${event} ON transcript_artifact_staleness WHEN NEW.artifact_kind = '${kind}' BEGIN ${remove(stale)} END`,
      );
    }
  }
}

/** Save normalized dependencies atomically with the question; fixed descriptors remain in its backup payload too. */
export async function appendVisitQuestionPeriod(
  tx: SqlExecutor,
  questionId: string,
  source: VisitQuestionHealthContextSource,
) {
  await tx.execute(
    'INSERT OR IGNORE INTO visit_question_periods (question_id, topic, from_key, to_key, dependency_id) VALUES (?, ?, ?, ?, ?)',
    [
      questionId,
      source.scope.topic,
      localQueryTimestampKey(source.scope.window.fromInclusive),
      localQueryTimestampKey(source.scope.window.toExclusive),
      healthPeriodDependencyId(source),
    ],
  );
}
