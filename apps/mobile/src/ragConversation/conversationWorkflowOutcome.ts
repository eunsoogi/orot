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
      return accepted(
        result.citations.length ||
          result.coverage.some(
            coverage => coverage.sourceKind === 'generated_artifact',
          )
          ? { status: 'insufficient' }
          : {
              status: 'answer',
              answer: result.value.answer,
              citations: [],
              ...(result.value.completion === 'partial'
                ? { completion: 'partial' }
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
    return accepted({
      status: 'answer',
      ...(result.value.completion === 'partial' || presentation.mixed
        ? { completion: 'partial' }
        : {}),
      // Label source-relative time even when the model omits that qualifier in its prose.
      answer: presentation.mixed
        ? `${result.value.answer}\n\n${t('ragConversation.mixed.recordComparisonUnavailable')}`
        : result.citations.some(isPublicWebReference)
          ? `${result.value.answer}\n\n${t('externalMedicalEvidence.answer.publicWebDisclaimer')}`
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
    });
  }
  return failureFromWorkflow(result);
}
