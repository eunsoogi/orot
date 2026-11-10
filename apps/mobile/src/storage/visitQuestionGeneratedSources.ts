import type { SqlExecutor } from '@orot/storage';

const sourceRows = (kind: string, parentId: string) => `
  SELECT json_extract(source.value, '$.kind') AS source_kind,
         json_extract(source.value, '$.id') AS source_id
  FROM visit_questions question,
       json_each(question.payload_json, '$.generatedArtifactSources') source
  WHERE json_extract(source.value, '$.kind') = '${kind}'
    AND json_extract(source.value, '$.id') = ${parentId}`;

/** Keep reviewed question lineage typed and revoke its saved-memory projection with the parent. */
async function revokeQuestionsForParent(
  tx: SqlExecutor,
  triggerName: string,
  parentKind: 'generated_summary' | 'generated_conversation',
  parentId: string,
  event: string,
  condition = '',
) {
  // Replace prior guard definitions when an existing database is reopened.
  await tx.execute(`DROP TRIGGER IF EXISTS ${triggerName}`);
  await tx.execute(`CREATE TRIGGER ${triggerName} AFTER ${event} ${condition} BEGIN
    INSERT OR IGNORE INTO agent_memory_removed_sources (source_id)
      SELECT 'generated-artifact:' || source_kind || ':' || source_id
      FROM (${sourceRows(parentKind, parentId)});
    DELETE FROM visit_question_records
      WHERE EXISTS (
        SELECT 1 FROM json_each(visit_question_records.payload_json, '$.questionSources') snapshot,
          json_each(snapshot.value, '$.generatedArtifactSources') source
        WHERE json_extract(source.value, '$.kind') = '${parentKind}'
          AND json_extract(source.value, '$.id') = ${parentId}
      );
    DELETE FROM visit_questions
      WHERE EXISTS (
        SELECT 1 FROM json_each(visit_questions.payload_json, '$.generatedArtifactSources') source
        WHERE json_extract(source.value, '$.kind') = '${parentKind}'
          AND json_extract(source.value, '$.id') = ${parentId}
      );
  END`);
}

/** Deletes a derived question when its exact generated parent is removed or invalidated. */
export async function setupVisitQuestionGeneratedSourceGuards(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS agent_memory_removed_sources (source_id TEXT PRIMARY KEY NOT NULL)',
  );
  const tables = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('symptom_summary_runs', 'conversation_artifacts', 'conversation_invalid_summaries', 'conversation_invalid_parents')",
  );
  const present = new Set(tables.rows.map(row => row.name));
  if (present.has('symptom_summary_runs')) {
    await revokeQuestionsForParent(
      tx,
      'visit_question_generated_summary_removed',
      'generated_summary',
      'OLD.id',
      'DELETE ON symptom_summary_runs',
    );
    await revokeQuestionsForParent(
      tx,
      'visit_question_generated_summary_changed',
      'generated_summary',
      'OLD.id',
      'UPDATE ON symptom_summary_runs',
      'WHEN OLD.id IS NOT NEW.id OR OLD.created_at IS NOT NEW.created_at OR OLD.model_name IS NOT NEW.model_name OR OLD.result_json IS NOT NEW.result_json',
    );
  }
  if (present.has('conversation_artifacts')) {
    await revokeQuestionsForParent(
      tx,
      'visit_question_generated_conversation_removed',
      'generated_conversation',
      'OLD.id',
      'DELETE ON conversation_artifacts',
    );
    await revokeQuestionsForParent(
      tx,
      'visit_question_generated_conversation_changed',
      'generated_conversation',
      'OLD.id',
      'UPDATE ON conversation_artifacts',
      'WHEN OLD.id IS NOT NEW.id OR OLD.session_id IS NOT NEW.session_id OR OLD.created_at IS NOT NEW.created_at OR OLD.result_json IS NOT NEW.result_json',
    );
  }
  if (present.has('conversation_invalid_summaries')) {
    await revokeQuestionsForParent(
      tx,
      'visit_question_generated_summary_invalidated',
      'generated_summary',
      'NEW.id',
      'INSERT ON conversation_invalid_summaries',
    );
  }
  if (present.has('conversation_invalid_parents')) {
    await revokeQuestionsForParent(
      tx,
      'visit_question_generated_conversation_invalidated',
      'generated_conversation',
      'NEW.id',
      'INSERT ON conversation_invalid_parents',
    );
  }
}
