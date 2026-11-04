import type { SqlExecutor } from '@orot/storage';
import { completeSummaryDeletion } from './summaryDeletionPolicy';

/** Install guards whenever either parent or descendant catalog opens, in the same database transaction. */
export async function setupResearchArtifactGuards(tx: SqlExecutor) {
  const tables = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('research_artifacts', 'research_artifact_sources', 'research_artifact_periods', 'symptom_summary_sources', 'symptom_summary_runs', 'conversation_artifact_sources', 'conversation_artifacts', 'conversation_artifact_sessions', 'visit_questions', 'agent_memory_removed_sources')",
  );
  const present = new Set(tables.rows.map(row => row.name));
  if (!present.has('research_artifacts')) return;
  if (present.has('conversation_artifact_sessions')) {
    await tx.execute(
      "CREATE TRIGGER IF NOT EXISTS research_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN DELETE FROM research_artifacts WHERE json_extract(snapshot_json, '$.originSession') = OLD.id; END",
    );
  }
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS research_artifact_affected (root_id INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (root_id, kind, id))',
  );
  const edges = [
    ...(present.has('research_artifact_sources')
      ? [
          "UNION SELECT 'generated_research', 'research-' || r.artifact_id FROM research_artifact_sources r JOIN descendants d ON r.record_kind = d.kind AND r.record_id = d.id",
        ]
      : []),
    ...(present.has('symptom_summary_sources')
      ? [
          "UNION SELECT 'generated_summary', s.summary_id FROM symptom_summary_sources s JOIN descendants d ON s.record_kind = d.kind AND s.record_id = d.id",
        ]
      : []),
    ...(present.has('conversation_artifact_sources')
      ? [
          "UNION SELECT 'generated_conversation', c.artifact_id FROM conversation_artifact_sources c JOIN descendants d ON c.record_kind = d.kind AND c.record_id = d.id",
        ]
      : []),
  ].join(' ');
  const questions = present.has('visit_questions')
    ? `
    ${
      present.has('agent_memory_removed_sources')
        ? `INSERT INTO agent_memory_removed_sources (source_id)
      SELECT 'generated-artifact:' || p.kind || ':' || p.id FROM research_artifact_affected p
      WHERE p.root_id = OLD.id AND NOT EXISTS (SELECT 1 FROM agent_memory_removed_sources existing WHERE existing.source_id = 'generated-artifact:' || p.kind || ':' || p.id);`
        : ''
    }
    DELETE FROM visit_questions WHERE EXISTS (SELECT 1 FROM json_each(visit_questions.payload_json, '$.generatedArtifactSources') s JOIN research_artifact_affected p ON json_extract(s.value, '$.kind') = p.kind AND json_extract(s.value, '$.id') = p.id WHERE p.root_id = OLD.id);`
    : '';
  for (const event of ['DELETE', 'UPDATE'] as const) {
    const name = `research_artifact_${event.toLowerCase()}_descendants`;
    await tx.execute(`DROP TRIGGER IF EXISTS ${name}`);
    const when =
      event === 'UPDATE'
        ? 'WHEN OLD.id IS NOT NEW.id OR OLD.snapshot_json IS NOT NEW.snapshot_json'
        : '';
    await tx.execute(`CREATE TRIGGER ${name} AFTER ${event} ON research_artifacts ${when} BEGIN
      ${event === 'UPDATE' ? 'INSERT INTO research_artifact_invalid (id) SELECT OLD.id WHERE NOT EXISTS (SELECT 1 FROM research_artifact_invalid WHERE id = OLD.id);' : ''}
      DELETE FROM research_artifact_affected WHERE root_id = OLD.id;
      INSERT INTO research_artifact_affected (root_id, kind, id)
        WITH RECURSIVE descendants(kind, id) AS (SELECT 'generated_research', 'research-' || OLD.id ${edges}) SELECT OLD.id, kind, id FROM descendants;
      ${questions}
      ${present.has('symptom_summary_runs') ? `DELETE FROM symptom_summary_runs WHERE ${completeSummaryDeletion} AND id IN (SELECT id FROM research_artifact_affected WHERE root_id = OLD.id AND kind = 'generated_summary');` : ''}
      ${present.has('conversation_artifacts') ? "DELETE FROM conversation_artifacts WHERE id IN (SELECT id FROM research_artifact_affected WHERE root_id = OLD.id AND kind = 'generated_conversation');" : ''}
      DELETE FROM research_artifacts WHERE id IN (SELECT CAST(substr(id, 10) AS INTEGER) FROM research_artifact_affected WHERE root_id = OLD.id AND kind = 'generated_research' AND id != 'research-' || OLD.id);
      ${present.has('research_artifact_sources') ? "DELETE FROM research_artifact_sources WHERE artifact_id IN (SELECT CAST(substr(id, 10) AS INTEGER) FROM research_artifact_affected WHERE root_id = OLD.id AND kind = 'generated_research');" : ''}
      ${present.has('research_artifact_periods') ? "DELETE FROM research_artifact_periods WHERE artifact_id IN (SELECT CAST(substr(id, 10) AS INTEGER) FROM research_artifact_affected WHERE root_id = OLD.id AND kind = 'generated_research');" : ''}
      DELETE FROM research_artifact_affected WHERE root_id = OLD.id;
    END`);
  }
}
