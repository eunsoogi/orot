import {
  forwardPossibilityCreation,
  type PossibilityAttempt,
} from '../conversationTools/possibilityOriginalReceipt';
import type { MultiAgentRunResult } from '@orot/agent-runtime';
import type { GroundedRagAnswer } from './task';
import type { RagConversationRunOptions } from './service';
import type { RagConversationOutcome } from './outcome';
import { reportWorkflowOutcome } from '../providers/diagnostics';
import { historicalArtifactOutcome } from './historicalArtifactAnswer';
import { trackValidatedEvidence } from './conversationRetentionEvidence';
import { isPublicWebReference } from '../externalMedicalEvidence/publicWebSources';
import { t } from '../i18n';
import {
  literatureCitationsMatch,
  literatureResultPresentation,
} from './literatureCitationBinding';
import { localClaimsMatch } from './localEvidenceClaims';
import { failureFromWorkflow } from './outcome';
import { publishPublicWebConversationLayout } from './conversationA2UIPublicWebLayout';
import { reportConversationA2UIFinalAdmission } from './conversationA2UIFinalDiagnostic';

export type ConversationOutcomeOptions = Pick<
  RagConversationRunOptions,
  | 'onInitialSearchStatus'
  | 'onValidatedEvidence'
  | 'readHistoricalArtifact'
  | 'resolveLocalEvidenceIdentity'
  | 'workflow'
>;

/** Fresh and cold execution share identical final grounding, lineage and presentation gates.
 * This function never performs initial retrieval or submits another model request. */
export async function conversationWorkflowOutcome(
  result: MultiAgentRunResult<GroundedRagAnswer>,
  options: ConversationOutcomeOptions,
  signal?: AbortSignal,
  possibilityAttempt?: PossibilityAttempt,
): Promise<RagConversationOutcome> {
  options.onInitialSearchStatus?.(result.checkpoint.initialSearchStatus);
  reportWorkflowOutcome(
    'rag',
    result.status,
    'providerErrorCode' in result ? result.providerErrorCode : undefined,
    'reason' in result ? result.reason : undefined,
  );
  if (result.status === 'result') {
    const accepted = trackValidatedEvidence(
      result.checkpoint?.evidenceReferences,
      options.onValidatedEvidence,
      signal,
    );
    if (result.value.answerKind === 'conversation') {
      const insufficient =
        result.citations.length > 0 ||
        result.coverage.some(
          coverage => coverage.sourceKind === 'generated_artifact',
        );
      if (!insufficient && !signal?.aborted)
        reportConversationA2UIFinalAdmission(result.value);
      return accepted(
        insufficient
          ? { status: 'insufficient' }
          : {
              status: 'answer',
              answer: result.value.answer,
              ...(result.value.proactiveMemory === true
                ? { proactiveMemory: true as const }
                : {}),
              ...(result.value.replyPreferenceSpan
                ? { replyPreferenceSpan: result.value.replyPreferenceSpan }
                : {}),
              ...(result.value.authoredRoutineSpan
                ? { authoredRoutineSpan: result.value.authoredRoutineSpan }
                : {}),
              citations: [],
              ...(result.value.a2uiPresentation && !signal?.aborted
                ? {
                    a2uiPresentation: result.value.a2uiPresentation,
                    ...(result.value.a2uiLocalDraft
                      ? { a2uiLocalDraft: result.value.a2uiLocalDraft }
                      : {}),
                  }
                : {}),
            },
      );
    }
    if (!result.citations.length) return { status: 'insufficient' };
    // A literature explanation must be built from the same references that survived citation validation.
    if (
      !literatureCitationsMatch(
        result.value.literatureReferences ?? [],
        result.citations,
      )
    )
      return { status: 'insufficient' };
    if (
      result.value.localReferences?.length &&
      !localClaimsMatch(result.value.localReferences, result.citations)
    )
      return { status: 'insufficient' };
    if (result.value.answerKind === 'prior_output') {
      return accepted(
        await historicalArtifactOutcome(
          result,
          options,
          signal ?? new AbortController().signal,
        ),
      );
    }
    // A previous AI statement cannot by itself ground a new clinical assertion.
    if (
      result.citations.some(
        reference => reference.sourceKind === 'generated_artifact',
      )
    )
      return { status: 'insufficient' };
    const presentation = literatureResultPresentation(
      result.value.literatureReferences,
      result.citations,
      Boolean(result.value.localReferences?.length),
    );
    const publicWebNotice = result.citations.some(isPublicWebReference)
      ? t('externalMedicalEvidence.answer.publicWebDisclaimer')
      : undefined;
    const publicWebLayout =
      publicWebNotice &&
      !presentation.mixed &&
      !result.partialEvidence &&
      !signal?.aborted
        ? publishPublicWebConversationLayout(
            result.value,
            presentation.citations,
            publicWebNotice,
          )
        : undefined;
    const candidate = {
      status: 'answer' as const,
      ...(publicWebLayout ? { a2uiPresentation: publicWebLayout } : {}),
      // Label source-relative time even when the model omits that qualifier in its prose.
      answer: presentation.mixed
        ? `${result.value.answer}\n\n${t('ragConversation.mixed.recordComparisonUnavailable')}`
        : publicWebNotice
          ? `${result.value.answer}\n\n${publicWebNotice}`
          : result.citations.some(
                reference => reference.sourceKind === 'external_medical',
              )
            ? `${result.value.answer}\n\n${t('externalMedicalEvidence.answer.publicLiteratureDisclaimer')}`
            : result.coverage.some(
                  coverage =>
                    coverage.truncated &&
                    coverage.selectionMethod === 'ranked_retrieval',
                )
              ? `${result.value.answer}\n\n${t('ragConversation.literature.historicalRankedEvidence')}`
              : `${result.value.answer}\n\n${t('ragConversation.literature.historicalEvidence')}`,
      citations: presentation.citations,
      // A separately verified current authorship span is not an evidence or
      // answer excerpt. Forward it only after the grounded answer gates pass.
      ...(result.value.replyPreferenceSpan
        ? { replyPreferenceSpan: result.value.replyPreferenceSpan }
        : {}),
      ...(result.value.authoredRoutineSpan
        ? { authoredRoutineSpan: result.value.authoredRoutineSpan }
        : {}),
      ...(result.value.proactiveMemory === true
        ? { proactiveMemory: true as const }
        : {}),
    };
    return accepted(
      possibilityAttempt &&
        !signal?.aborted &&
        result.value.answerKind === 'grounded' &&
        result.citations.every(ref => ref.sourceKind === 'personal_record')
        ? forwardPossibilityCreation(
            candidate,
            result.value,
            possibilityAttempt,
          )
        : candidate,
    );
  }
  return failureFromWorkflow(result);
}
