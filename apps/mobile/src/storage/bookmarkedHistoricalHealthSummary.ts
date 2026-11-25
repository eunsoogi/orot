import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  fingerprint,
  stableJson,
} from '../aiFeatures/integration/evidenceUtils';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import type { HealthSummaryResult } from '../ragConversation/healthSummary';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { readStandaloneSavedHealthSummaryRow } from './standaloneSavedHealthSummary';

export type HistoricalBookmarkedHealthSummary = HealthSummaryResult & {
  readonly historicalSnapshot: true;
};

async function readAttestedPin(tx: SqlExecutor, id: string) {
  const schema = await tx.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name IN ('standalone_summary_body_receipts', 'saved_health_summary_refs')",
  );
  if (schema.rows.length !== 2) return null; // No legacy backfill or read-time changes.
  const row = (
    await tx.execute(
      `SELECT a.result_json, a.session_id, a.created_at, b.summary_id, b.revision,
              r.created_at AS summary_created_at
       FROM saved_health_summary_refs b
       JOIN conversation_artifacts a ON a.id=b.artifact_id
       JOIN conversation_artifact_sessions s ON s.id=a.session_id AND s.hidden=0
       JOIN conversation_artifact_generation g ON g.singleton=1 AND g.generation=s.generation
       JOIN symptom_summary_runs r ON r.id=b.summary_id
       WHERE a.id=?
         AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id=a.id)
         AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents i WHERE i.id=a.id)
         AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions d WHERE d.id=s.id)`,
      [id],
    )
  ).rows[0];
  const artifact = decodeConversationArtifact(row?.result_json);
  const reference = artifact?.healthSummary;
  if (
    !row ||
    !artifact ||
    !reference ||
    artifact.status !== 'complete' ||
    artifact.id !== id ||
    artifact.sessionId !== row.session_id ||
    artifact.createdAt !== row.created_at ||
    artifact.sources.length !== 0 ||
    artifact.citations?.length !== 0 ||
    artifact.submittedInput ||
    artifact.dailyReport ||
    artifact.visitQuestions ||
    artifact.treatmentContext ||
    reference.summaryId !== row.summary_id ||
    typeof row.summary_created_at !== 'string'
  )
    return null;
  const body = await readStandaloneSavedHealthSummaryRow(tx, {
    id: reference.summaryId,
    createdAt: row.summary_created_at,
  });
  if (
    !body?.sourceRevision ||
    body.saved.providerId !== artifact.providerId ||
    body.saved.modelId !== artifact.modelId ||
    fingerprint(body.saved) !== row.revision ||
    !body.saved.sources.length ||
    !body.saved.sources.every(
      source =>
        isPeriodSummarySource(source) &&
        source.scope.topic === 'measurements' &&
        stableJson(source.scope.window) === stableJson(reference.window),
    )
  )
    return null;
  return { reference, body, owner: row.result_json };
}

/** Historical body only: join the original pin and proven numeric correction,
 * then reprove exact bytes after the asynchronous native protection witness. */
export async function readBookmarkedHistoricalHealthSummary(
  database: SqlDatabase,
  id: string,
  current: () => boolean,
  confirmProtected: () => Promise<boolean>,
): Promise<HistoricalBookmarkedHealthSummary | null> {
  const read = async () => {
    const result: {
      value: Awaited<ReturnType<typeof readAttestedPin>>;
    } = { value: null };
    await database.transaction(async tx => {
      if (current()) result.value = await readAttestedPin(tx, id);
    });
    return current() ? result.value : null;
  };
  if (!current()) return null;
  const original = await read();
  if (!original || !(await confirmProtected()) || !current()) return null;
  const reprove = async () => {
    const next = await read();
    return next &&
      next.owner === original.owner &&
      next.body.serialized === original.body.serialized
      ? next
      : null;
  };
  if (!(await reprove()) || !(await confirmProtected()) || !current())
    return null;
  const confirmed = await reprove();
  if (!confirmed) return null;
  const { analysis, id: summaryId, createdAt, modelName } = confirmed.body.saved;
  return {
    reference: confirmed.reference,
    historicalSnapshot: true,
    analysis: {
      presentation: 'symptom_summary',
      ...(analysis.omittedUnsupportedContent === true
        ? { omittedUnsupportedContent: true }
        : {}),
      ...(analysis.incompleteEvidence === true
        ? { incompleteEvidence: true }
        : {}),
      hypotheses: analysis.hypotheses.map(section => ({
        title: section.title,
        summary: section.summary,
        missingData: section.missingData,
        uncertainty: section.uncertainty,
        supportingEvidence: [],
        contraryEvidence: [],
      })),
      savedSummary: {
        status: 'saved',
        id: summaryId,
        createdAt,
        modelName,
        sourceChanged: true,
      },
    },
  };
}
