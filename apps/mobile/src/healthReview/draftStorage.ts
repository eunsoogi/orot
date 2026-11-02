import { createLangGraphCheckpointStorage } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import {
  emptyHealthReviewSafety,
  healthReviewSafetyInput,
} from './safetyInput';
import type { HealthReviewSafetyDraft } from './safetyInput';

const thread = (id: string) => `health-review-draft:${encodeURIComponent(id)}`;

/** Drafts use a source-linked encrypted checkpoint, separate from strict graph pending data. */
export function createHealthReviewDraftStorage(database: SqlDatabase) {
  const storage = (id: string) =>
    createLangGraphCheckpointStorage(database, { sourceRecordId: id });
  return {
    async save(id: string, draft: HealthReviewSafetyDraft) {
      await storage(id).saveCheckpoint(thread(id), 'app-draft', {
        checkpointId: 'draft',
        parentCheckpointId: null,
        checkpointType: 'health-review-draft-v1',
        checkpoint: new TextEncoder().encode(JSON.stringify(draft)),
        metadataType: 'empty',
        metadata: new Uint8Array(),
      });
    },
    async read(id: string): Promise<HealthReviewSafetyDraft | undefined> {
      const row = await storage(id).loadCheckpoint(
        thread(id),
        'app-draft',
        'draft',
      );
      if (!row) return undefined;
      if (row.checkpointType !== 'health-review-draft-v1')
        throw new Error('Unknown review draft.');
      const value: unknown = JSON.parse(
        new TextDecoder().decode(row.checkpoint),
      );
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid review draft.');
      const draft = value as HealthReviewSafetyDraft;
      if (
        !Array.isArray(draft.signs) ||
        typeof draft.otherSelected !== 'boolean' ||
        typeof draft.otherText !== 'string' ||
        !['unknown', 'yes', 'no'].includes(draft.upcomingVisit) ||
        !['unknown', 'no_new_or_concerning_symptoms', 'warning_signs'].includes(
          draft.symptoms,
        )
      )
        throw new Error('Invalid review draft.');
      // Validate retained signs even while the parent choice hides them.
      healthReviewSafetyInput({
        ...emptyHealthReviewSafety(),
        ...draft,
        symptoms: draft.signs.length ? 'warning_signs' : 'unknown',
      });
      return draft;
    },
  };
}
