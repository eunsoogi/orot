import type { SqlDatabase } from '@orot/storage';
import { operationRunId } from '../aiFeatures/integration/featureRunIdentity';
import { t } from '../i18n';
import { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { treatmentArtifactPredicate } from '../storage/treatmentSessionIdentity';
import type { TreatmentRetention } from './treatmentRequestProducer';

export interface SavedTreatmentChoice {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
}
export interface TreatmentSessionLease {
  readonly id: string;
  readonly version: number;
}

/** Discovery returns metadata only. The dedicated producer owns all text reads. */
export async function listSavedTreatment(
  database: SqlDatabase,
  lease: TreatmentSessionLease,
) {
  const store = createConversationArtifactStorage(database);
  if ((await store.activeSessionVersion(lease.id)) !== lease.version) return [];
  const page = await store.list(lease.id, undefined, 50, 'treatment');
  if ((await store.activeSessionVersion(lease.id)) !== lease.version) return [];
  return page.items.map(item => ({ ...item, sessionId: lease.id }));
}

/** The conversation owns the durable identity and storage checks its lease at commit. */
export function prepareTreatmentRetention(
  lease: TreatmentSessionLease,
  prior?: SavedTreatmentChoice,
): TreatmentRetention {
  if (prior && prior.sessionId !== lease.id)
    throw new Error('The treatment session is no longer available.');
  return {
    id: operationRunId(),
    sessionId: lease.id,
    createdAt: new Date().toISOString(),
    question: t('treatmentSafety.open'),
    expectedSessionVersion: lease.version,
  };
}

/** The existing delete trigger revokes this artifact and any retained descendants. */
export async function deleteSavedTreatment(
  database: SqlDatabase,
  item: SavedTreatmentChoice,
  lease: TreatmentSessionLease,
) {
  if (item.sessionId !== lease.id) return;
  await database.execute(
    `DELETE FROM conversation_artifacts AS a WHERE a.id = ? AND a.session_id = ?
      AND ${treatmentArtifactPredicate}
      AND EXISTS (SELECT 1 FROM conversation_artifact_sessions s
      JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
      WHERE s.id = a.session_id AND s.hidden = 0 AND s.version = ?)`,
    [item.id, lease.id, lease.version],
  );
}
