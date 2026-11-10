import type { SqlDatabase } from '@orot/storage';
import { operationRunId } from '../aiFeatures/integration/featureRunIdentity';
import { t } from '../i18n';
import { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { treatmentSessionId } from '../storage/treatmentSessionIdentity';
import type { TreatmentRetention } from './treatmentRequestProducer';

export interface SavedTreatmentChoice {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
}

/** Discovery returns metadata only. The dedicated producer owns all text reads. */
export async function listSavedTreatment(database: SqlDatabase) {
  const store = createConversationArtifactStorage(database);
  const sessionId = treatmentSessionId(await store.currentGeneration());
  const page = await store.list(sessionId);
  return page.items.map(item => ({ ...item, sessionId }));
}

/** Store only verified output and provenance, using the generation active when the request began. */
export async function prepareTreatmentRetention(
  database: SqlDatabase,
  signal: AbortSignal,
  prior?: SavedTreatmentChoice,
): Promise<TreatmentRetention> {
  const store = createConversationArtifactStorage(database);
  const generation = await store.currentGeneration();
  const sessionId = treatmentSessionId(generation);
  if (signal.aborted || (prior && prior.sessionId !== sessionId))
    throw new Error('The treatment session is no longer available.');
  const active = await store.activeSessionVersion(sessionId);
  if (prior && active === null)
    throw new Error('The treatment session is no longer available.');
  const version = active ?? (await store.createSession(sessionId, generation));
  return {
    id: operationRunId(),
    sessionId,
    createdAt: new Date().toISOString(),
    question: t('treatmentSafety.open'),
    expectedSessionVersion: version,
  };
}

/** The existing delete trigger revokes this artifact and any retained descendants. */
export async function deleteSavedTreatment(
  database: SqlDatabase,
  item: SavedTreatmentChoice,
) {
  const store = createConversationArtifactStorage(database);
  if (item.sessionId !== treatmentSessionId(await store.currentGeneration()))
    return;
  await database.execute(
    'DELETE FROM conversation_artifacts WHERE id = ? AND session_id = ?',
    [item.id, item.sessionId],
  );
}
