import type { SqlExecutor } from '@orot/storage';
import { decodeSavedSymptomSummary } from '../../storage/symptomSummaryStorageCodec';
import { decodeConversationArtifact } from '../../storage/conversationArtifactCodec';
import { readResearchArtifact } from '../../storage/researchArtifactCodec';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import type { VisitQuestionEvidenceMetadata } from './evidence';
import type { VisitQuestionEvidenceItem } from './taskContract';

/** Recheck the exact generated parent inside the reviewed-question write transaction. */
export async function assertGeneratedVisitQuestionSource(
  item: VisitQuestionEvidenceItem,
  metadata: VisitQuestionEvidenceMetadata,
  sql?: SqlExecutor,
): Promise<void> {
  const source = metadata.generatedArtifactSource;
  const locator =
    typeof item.locator === 'object' &&
    item.locator !== null &&
    !Array.isArray(item.locator)
      ? (item.locator as Readonly<Record<string, unknown>>)
      : undefined;
  if (
    !sql ||
    !source ||
    source.id !== item.sourceId ||
    source.id !== item.evidenceId ||
    source.revision !== item.sourceRevision ||
    source.revision !== item.evidenceRevision ||
    locator?.kind !== 'generated_artifact' ||
    locator.type !== source.type ||
    (source.kind === 'generated_conversation') !==
      (source.type === 'conversation_turn') ||
    (source.kind === 'generated_research') !==
      (source.type === 'research_publication' ||
        source.type === 'research_web_explanation')
  )
    throw new Error('The generated artifact parent is incomplete or invalid.');
  if (source.kind === 'generated_research') {
    const saved = await readResearchArtifact(sql, source.id);
    const type =
      saved?.source.kind === 'publication'
        ? 'research_publication'
        : 'research_web_explanation';
    if (
      !saved ||
      type !== source.type ||
      fingerprint(saved) !== source.revision
    )
      throw new Error('The saved research result changed or was removed.');
    return;
  }
  if (source.kind === 'generated_summary') {
    const invalid = await sql.execute(
      'SELECT id FROM conversation_invalid_summaries WHERE id = ? LIMIT 1',
      [source.id],
    );
    const result = await sql.execute(
      'SELECT result_json FROM symptom_summary_runs WHERE id = ? LIMIT 1',
      [source.id],
    );
    const saved = decodeSavedSymptomSummary(result.rows[0]?.result_json);
    const type =
      saved?.analysis.presentation === 'symptom_summary'
        ? 'symptom_summary'
        : 'disease_possibilities';
    if (
      invalid.rows.length ||
      !saved ||
      saved.inputLineage !== 'complete' ||
      type !== source.type ||
      fingerprint(saved) !== source.revision
    )
      throw new Error('The generated summary changed or was removed.');
    return;
  }
  const result = await sql.execute(
    `SELECT a.result_json, a.id, a.session_id, a.created_at
       FROM conversation_artifacts a
       JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0
       JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
       WHERE a.id = ?
       AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents i WHERE i.id = a.id)
       AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)`,
    [source.id],
  );
  const row = result.rows[0];
  const saved = decodeConversationArtifact(row?.result_json);
  if (
    !saved ||
    saved.id !== row?.id ||
    saved.sessionId !== row?.session_id ||
    saved.createdAt !== row?.created_at ||
    saved.citations === undefined ||
    fingerprint(saved) !== source.revision
  )
    throw new Error('The generated conversation changed or was removed.');
  return;
}
