import type { SqlExecutor } from '@orot/storage';
import { markerMatchesArtifactSource } from './typedDeletionMarkers';

/** Check only negative, durable removal metadata. There is no source body,
 * snapshot freshness, parent content, revision, or existence requirement.
 * Conversation parent edges are persisted at save and carry transitive Hide. */
export async function suppressExplicitlyRemovedHistory(
  tx: SqlExecutor,
  ids: readonly string[],
) {
  if (!ids.length) return [];
  const markers = ['source_deletion_tombstones', 'agent_memory_removed_sources']
    .map(
      table => `EXISTS (SELECT 1 FROM ${table} m
        WHERE (m.source_id = conversation_artifact_sources.record_id AND conversation_artifact_sources.record_kind NOT IN ('generated_summary','generated_research','generated_conversation')
          AND ${markerMatchesArtifactSource(table, 'm.source_id', 'conversation_artifact_sources', 'identity')})
          OR (conversation_artifact_sources.record_kind IN ('generated_summary','generated_research','generated_conversation')
            AND m.source_id = 'generated-artifact:' || conversation_artifact_sources.record_kind || ':' || conversation_artifact_sources.record_id))`,
    )
    .join(' OR ');
  const { rows } = await tx.execute(
    `SELECT * FROM (WITH RECURSIVE ownership(root, artifact_id) AS (
       SELECT value, value FROM json_each(?)
       UNION
       SELECT p.root, e.record_id FROM ownership p JOIN conversation_artifact_sources e
         ON e.artifact_id = p.artifact_id AND e.record_kind = 'generated_conversation'
     )
     SELECT DISTINCT p.root AS id FROM ownership p
     WHERE EXISTS (SELECT 1 FROM conversation_artifact_sources WHERE artifact_id = p.artifact_id
       AND ((record_kind = 'generated_summary' AND EXISTS (
         SELECT 1 FROM conversation_invalid_summaries s WHERE s.id = record_id
       )) OR ${markers}))
     OR (p.artifact_id <> p.root AND (
        EXISTS (SELECT 1 FROM conversation_invalid_parents x WHERE x.id = p.artifact_id)
        OR EXISTS (SELECT 1 FROM conversation_deleted_artifacts x WHERE x.id = p.artifact_id)
        OR EXISTS (SELECT 1 FROM conversation_artifacts a
           JOIN conversation_artifact_sessions s ON s.id = a.session_id
           WHERE a.id = p.artifact_id AND (s.hidden <> 0 OR EXISTS (
             SELECT 1 FROM conversation_artifact_removed_sessions x WHERE x.id = s.id
           )))
     )))`,
    [JSON.stringify(ids)],
  );
  return rows.flatMap(row => (typeof row.id === 'string' ? [row.id] : []));
}
