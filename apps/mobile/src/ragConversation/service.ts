import { conversationInitialEvidence } from './conversationInitialEvidence';
import { runContinuableConversationWorkflow } from './conversationWorkflowContinuation';
import type { ConversationWorkflowContinuation } from './conversationWorkflowContinuation';
import {
  providerDiagnostic,
  reportWorkflowOutcome,
} from '../providers/diagnostics';
import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceReference,
  MultiAgentInvocation,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { revalidateWithLocalDeletionGuard } from '../aiFeatures/integration/deletionAwareEvidence';
import type { LocalEvidenceIdentityResolver } from '../aiFeatures/integration/deletionAwareEvidence';
import type { EvidenceSourceReadResult } from '../aiFeatures/integration/evidenceSourceDocument';
import { historicalArtifactOutcome } from './historicalArtifactAnswer';
import { conversationWorkflowContext } from './conversationWorkflowContext';
import { trackValidatedEvidence } from './conversationRetentionEvidence';
import type { LocalE5RagService } from '../rag/localE5RagService';
import { ragConversationTask } from './task';
import { isPublicWebReference } from '../externalMedicalEvidence/publicWebSources';
import { t } from '../i18n';
import {
  literatureCitationsMatch,
  literatureResultPresentation,
} from './literatureCitationBinding';
import { localClaimsMatch } from './localEvidenceClaims';
import type {
  GroundedRagAnswer,
  RagConversationCurrentEvidence,
  RagConversationMessage,
} from './task';
import { failureFromWorkflow } from './outcome';
import type { RagConversationOutcome } from './outcome';
import type { ConversationIntent } from '../aiFeatures/integration/conversationIntent';
import { bufferPossibilityStream } from './possibilityStreamBoundary';
import { validConversationPhotoRun } from './conversationPhotoRunValidation';

export type {
  RagConversationFailureKind,
  RagConversationOutcome,
} from './outcome';

export type { RagConversationObserver } from './conversationObserver';

export interface RagConversationRunOptions {
  readonly continuation?: ConversationWorkflowContinuation;
  readonly question: string;
  readonly entryIntent?: ConversationIntent;
  readonly targetVisitEvidence?: EvidenceItem;
  readonly dailyReportEvidence?: readonly EvidenceItem[];
  /** Photo evidence and its explicit payload consent must arrive together. */
  readonly photoEvidence?: readonly EvidenceItem[];
  readonly previousMessages: readonly RagConversationMessage[];
  /** Locally revalidated prior turns; assistant text is dialogue context, not medical evidence. */
  readonly validatedPriorTurns?: readonly {
    question: string;
    answer: string;
  }[];
  readonly priorDialogueOmitted?: boolean;
  readonly loadCurrentEvidence: (
    question: string,
    signal: AbortSignal,
  ) => Promise<RagConversationCurrentEvidence>;
  readonly rag: Pick<LocalE5RagService, 'search'>;
  /** Public search results are already retrieved and are not local embedding hits. */
  readonly publicEvidence?: EvidenceBatch;
  readonly resolveLocalEvidenceIdentity?: LocalEvidenceIdentityResolver;
  readonly readHistoricalArtifact?: (
    reference: EvidenceReference,
    signal: AbortSignal,
  ) => Promise<EvidenceSourceReadResult>;
  /** The caller may capture all admitted inputs only after the final answer passes validation. */
  readonly onValidatedEvidence?: (
    references: readonly EvidenceReference[],
  ) => void;
  readonly workflow: Omit<
    MultiAgentWorkflowOptions<GroundedRagAnswer>,
    'request' | 'context' | 'task' | 'initialEvidence'
  >;
}

/** Runs local E5 retrieval on a fresh bounded snapshot before every consent-checked model turn. */
export async function runRagConversationTurn(
  options: RagConversationRunOptions,
  invocation: MultiAgentInvocation = {},
): Promise<RagConversationOutcome> {
  const question = options.question.trim();
  const validPhoto = validConversationPhotoRun(options);
  if (
    (!question && !validPhoto) ||
    question.length > 1000 ||
    Boolean(options.photoEvidence) !== Boolean(validPhoto) ||
    Boolean(options.workflow.photoInput) !== Boolean(validPhoto)
  )
    return { status: 'failure', kind: 'validation_failed' };
  let stage: 'data' | 'workflow' = 'data';
  try {
    providerDiagnostic('rag', 'data', 'started');
    const initialEvidence = await conversationInitialEvidence(
      options,
      question,
      invocation.signal,
    );
    providerDiagnostic('rag', 'data', 'completed');
    // The model may answer a social or clarifying turn even when retrieval has no hits.
    // The task/runtime still require a lookup and citations for substantive factual claims.
    stage = 'workflow';
    providerDiagnostic('rag', 'workflow', 'started');
    const result = await runContinuableConversationWorkflow(
      {
        ...options.workflow,
        request: question,
        context: conversationWorkflowContext(options),
        task: ragConversationTask,
        initialEvidence,
        revalidateEvidence: (references, signal) =>
          revalidateWithLocalDeletionGuard(
            references,
            signal,
            options.workflow.revalidateEvidence,
            options.resolveLocalEvidenceIdentity,
          ),
      },
      bufferPossibilityStream(options.entryIntent, invocation),
      options.continuation,
    );
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
        invocation.signal,
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
            invocation.signal ?? new AbortController().signal,
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
  } catch (error) {
    if (
      invocation.signal?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    )
      return { status: 'failure', kind: 'cancelled' };
    providerDiagnostic('rag', stage, 'failed');
    return {
      status: 'failure',
      kind: stage === 'data' ? 'retrieval_failed' : 'unavailable',
    };
  }
}
