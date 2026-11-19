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
  const path = new Set<string>();
  const measureCost = profileHistoryValidation
    ? measureHistoryValidationCost
    : undefined;
  let visited = 0;
  const visit = async (current: ConversationArtifact): Promise<void> => {
    if (path.has(current.id) || path.size >= 16 || ++visited > 128)
      throw new RetainedSourceInvalidError(
        'Conversation ancestry is cyclic or too large.',
      );
    path.add(current.id);
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
    for (const source of current.sources) {
      if (isConversationPhotoSource(source)) {
        // The protected request/source join above is the authority for this photo.
        continue;
      } else if (isGeneratedSummarySource(source)) {
        await assertConversationSummaryParent(
          tx,
          database,
          source,
          validatePeriod,
          measureCost,
        );
      } else if (isGeneratedConversationSource(source)) {
        const result = await tx.execute(
          `SELECT a.result_json, a.id, a.session_id, a.created_at FROM conversation_artifacts a
          JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0
          JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
          WHERE a.id = ? AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents i WHERE i.id = a.id) AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)`,
          [source.id],
        );
        const row = result.rows[0];
        const parent = measureCost
          ? measureCost('artifact_parent_decode', () =>
              decodeConversationArtifact(row?.result_json),
            )
          : decodeConversationArtifact(row?.result_json);
        if (
          !parent ||
          parent.id !== row?.id ||
          parent.sessionId !== row.session_id ||
          parent.createdAt !== row.created_at ||
          parent.citations === undefined ||
          (measureCost
            ? measureCost('artifact_parent_fingerprint', () =>
                fingerprint(parent),
              )
            : fingerprint(parent)) !== source.revision
        )
          throw new RetainedSourceInvalidError(
            'The generated conversation changed or was removed.',
          );
        await visit(parent);
      } else {
        // Existing parents keep scoped deletion guards rather than a new turn's global lease.
        await assertRetainedEvidenceCurrent(
          tx,
          [source],
          history,
          requireGeneration && path.size === 1,
          undefined,
          validatePeriod,
        );
      }
    }
    if (current.treatmentContext)
      await assertTreatmentAttribution(
        tx,
        history,
        current.treatmentContext,
        current.sources,
      );
    path.delete(current.id);
    collectValidated?.(current);
  };
  await visit(artifact);
}
