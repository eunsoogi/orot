import {
  createManualHistoryRepository,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import type { SavedGeneratedSummarySource } from '../ragConversation/conversationArtifactSources';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';

/** A generated parent is usable only at its exact revision with every input still current. */
export async function assertConversationSummaryParent(
  tx: SqlExecutor,
  database: SqlDatabase,
  source: SavedGeneratedSummarySource,
) {
  const deleted = await tx.execute(
    'SELECT id FROM conversation_invalid_summaries WHERE id = ? LIMIT 1',
    [source.id],
  );
  const rows = await tx.execute(
    'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
    [source.id],
  );
  const summary = decodeSavedSymptomSummary(rows.rows[0]?.result_json);
  const expectedType =
    summary?.analysis.presentation === 'symptom_summary'
      ? 'symptom_summary'
      : 'disease_possibilities';
  if (
    deleted.rows.length ||
    !summary ||
    summary.inputLineage !== 'complete' ||
    fingerprint(summary) !== source.revision ||
    (source.reference.locator as { type?: unknown }).type !== expectedType
  )
    throw new RetainedSourceInvalidError(
      'The generated summary changed or was removed.',
    );
  await assertRetainedEvidenceCurrent(
    tx,
    summary.sources,
    createManualHistoryRepository(database),
    false,
  );
}
