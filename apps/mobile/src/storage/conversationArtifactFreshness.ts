import {
  createConversationAncestryTraversal,
  type ConversationSharedAncestry,
  type ConversationAncestryParent,
} from './conversationSharedAncestry';
import type { BoundParentDigest } from './boundParentDigest';
import { assertBatchedHistoryRecords } from './batchedHistoryRecords';
import type { ReadOnlyPeriodValidation } from './readOnlyPeriodValidation';
import {
  createManualHistoryRepository,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import {
  isGeneratedConversationSource,
  isGeneratedSummarySource,
  isConversationPhotoSource,
} from '../ragConversation/conversationArtifactSources';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';
import { assertConversationSourcesNotRemoved } from './conversationArtifactDependencies';
import { assertConversationSummaryParent } from './conversationSummaryParent';
import { validateDailyReportArtifact } from './dailyReportArtifactValidation';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';
import { assertTreatmentAttribution } from '../treatmentContext/attribution';
import { assertConversationRequestSource } from './conversationRequestSources';
import {
  measureHistoryValidationCost,
  startHistoryValidationCost,
} from '../providers/conversationHistoryDiagnostic';

/** Validate a bounded ancestry in one transaction, rejecting cycles and unavailable parents. */
export async function assertConversationArtifactCurrent(
  tx: SqlExecutor,
  database: SqlDatabase,
  artifact: ConversationArtifact,
  requireGeneration: boolean,
  validatePeriod?: ReadOnlyPeriodValidation,
  collectValidated?: (artifact: ConversationArtifact) => void,
  profileHistoryValidation = false,
  canBatchOrdinary?: () => boolean,
  boundParentDigest?: BoundParentDigest,
  boundParentDecode?: typeof decodeConversationArtifact,
  sharedAncestry?: ConversationSharedAncestry,
) {
  const history = createManualHistoryRepository(database);
  // New report-bound turns must still belong to the active revision at commit.
  // A previously committed turn can be reopened using its original record lineage.
  if (requireGeneration && artifact.dailyReport) {
    const target = artifact.dailyReport;
    const active = await validateDailyReportArtifact(tx, target.runId, history);
    if (
      active?.context.identity.key !== target.identity.key ||
      active.revision !== target.revision
    )
      throw new RetainedSourceInvalidError(
        'The selected report changed before saving.',
      );
  }
  const ancestry = createConversationAncestryTraversal(
    tx,
    requireGeneration || collectValidated || canBatchOrdinary
      ? undefined
      : sharedAncestry,
  );
  const measureCost = profileHistoryValidation
    ? measureHistoryValidationCost
    : undefined;
  const visit = async (
    current: ConversationArtifact,
    expectedParent?: ConversationAncestryParent,
  ): Promise<void> => {
    ancestry.enter(current.id);
    const finishAuthority = profileHistoryValidation
      ? startHistoryValidationCost('artifact_source_authority')
      : undefined;
    try {
      await assertConversationRequestSource(tx, current);
      await assertConversationSourcesNotRemoved(tx, current);
      finishAuthority?.('completed');
    } catch (error) {
      finishAuthority?.('failed');
      throw error;
    }
    const batched =
      !requireGeneration && ancestry.depth === 1 && canBatchOrdinary?.()
        ? await assertBatchedHistoryRecords(tx, current, canBatchOrdinary)
        : false;
    if (batched) {
      ancestry.leave(current.id, expectedParent);
      collectValidated?.(current);
      return;
    }
    for (const source of current.sources) {
      if (isConversationPhotoSource(source)) {
        // The protected request/source join above is the authority for this photo.
        continue;
      } else if (isGeneratedSummarySource(source)) {
        // Observe this original await without adding a promise or changing its owner.
        const finishRead = profileHistoryValidation
          ? startHistoryValidationCost('artifact_summary_parent')
          : undefined;
        try {
          await assertConversationSummaryParent(
            tx,
            database,
            source,
            validatePeriod,
            measureCost,
          );
          finishRead?.('completed');
        } catch (error) {
          finishRead?.('failed');
          throw error;
        }
      } else if (isGeneratedConversationSource(source)) {
        if (ancestry.reuse(source)) continue;
        // Observe this original await without adding a promise or changing its owner.
        const finishRead = profileHistoryValidation
          ? startHistoryValidationCost('artifact_parent_row')
          : undefined;
        let result;
        try {
          result = await tx.execute(
            `SELECT a.result_json, a.id, a.session_id, a.created_at FROM conversation_artifacts a
          JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0
          JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
          WHERE a.id = ? AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents i WHERE i.id = a.id) AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)`,
            [source.id],
          );
          finishRead?.('completed');
        } catch (error) {
          finishRead?.('failed');
          throw error;
        }
        const row = result.rows[0];
        const raw = row?.result_json;
        const decodeParent = boundParentDecode ?? decodeConversationArtifact;
        const parent = measureCost
          ? measureCost('artifact_parent_decode', () => decodeParent(raw))
          : decodeParent(raw);
        const digest = (validated: ConversationArtifact) =>
          boundParentDigest && typeof raw === 'string'
            ? boundParentDigest(raw, validated, source.revision)
            : fingerprint(validated);
        if (
          !parent ||
          parent.id !== row?.id ||
          parent.sessionId !== row.session_id ||
          parent.createdAt !== row.created_at ||
          parent.citations === undefined ||
          (measureCost
            ? measureCost('artifact_parent_fingerprint', () => digest(parent))
            : digest(parent)) !== source.revision
        )
          throw new RetainedSourceInvalidError(
            'The generated conversation changed or was removed.',
          );
        await visit(parent, source);
      } else {
        // Existing parents keep scoped deletion guards rather than a new turn's global lease.
        // Observe this original await without adding a promise or changing its owner.
        const finishRead = profileHistoryValidation
          ? startHistoryValidationCost('artifact_retained_source')
          : undefined;
        try {
          await assertRetainedEvidenceCurrent(
            tx,
            [source],
            history,
            requireGeneration && ancestry.depth === 1,
            undefined,
            validatePeriod,
          );
          finishRead?.('completed');
        } catch (error) {
          finishRead?.('failed');
          throw error;
        }
      }
    }
    if (current.treatmentContext)
      await assertTreatmentAttribution(
        tx,
        history,
        current.treatmentContext,
        current.sources,
      );
    ancestry.leave(current.id, expectedParent);
    collectValidated?.(current);
  };
  await visit(artifact);
}
