import type { MultiAgentRunResult } from '@orot/agent-runtime';
import type { ProviderErrorCode } from '@orot/model-runtime';
import type { GroundedRagAnswer } from './task';
import type { VisitQuestionPreflightRecovery } from '../nextVisitQuestions/savedQuestionRecovery';

export type RagConversationFailureKind =
  | 'provider_authentication'
  | 'provider_rate_limited'
  | 'provider_configuration'
  | 'provider_refused'
  | 'provider_unavailable'
  | 'consent_required'
  | 'cancelled'
  | 'retrieval_failed'
  | 'daily_report_sources_unavailable'
  | 'daily_report_retry_current'
  | 'validation_failed'
  | 'stale_evidence'
  | 'visit_no_appointment'
  | 'visit_saved_unavailable'
  | 'authored_memory_not_saved'
  | 'answer_memory_not_saved'
  | 'protected_memory_not_saved'
  | 'budget_exceeded'
  | 'unavailable';

/** Only a completed protected answer supplies this archive lookup identity. */
export type CommittedConversationCitations = {
  readonly target: import('./useArchivedCitationOpen').ArchivedCitationTarget;
  readonly citations: readonly import('./savedArchivedCitations').SavedArchivedCitation[];
};

export type RagConversationOutcome =
  | { readonly status: 'no_evidence' }
  | {
      readonly status: 'answer';
      readonly answer: string;
      /** Issued by protected storage only after the exact generated original commits. */
      readonly committedPossibilityOriginal?: true;
      readonly committedRecordingCitations?: CommittedConversationCitations;
      readonly proactiveMemory?: true;
      readonly replyPreferenceSpan?: string;
      readonly authoredRoutineSpan?: string;
      /** Only the host’s committed local answer bookmark can set this receipt. */
      readonly committedAnswerMemory?: true;
      readonly alreadySavedAnswerMemory?: true;
      readonly a2uiPresentation?: import('./conversationA2UI').ConversationA2UINode;
      readonly a2uiLocalDraft?: import('./conversationA2UILocalDraft').ConversationA2UILocalDraft;
      readonly dailyReport?: import('./conversationDisplayMessage').DisplayMessage['dailyReport'];
      readonly completion?: 'partial';
      readonly citations: readonly import('@orot/agent-runtime').EvidenceReference[];
      /** Local input lineage may include sources omitted from visible citations. */
      readonly healthSources?: import('./conversationHealthDeletion').HealthSourceDependencies;
      readonly healthSummary?: import('./healthSummary').HealthSummaryResult;
      readonly retryHealthSummary?: () => Promise<
        import('./healthSummary').HealthSummaryResult | null
      >;
      readonly visitQuestions?: import('./conversationVisitQuestions').ConversationVisitQuestions;
    }
  | {
      readonly status: 'insufficient';
      readonly guidance?: 'visit_goal' | 'recording_selector';
    }
  | {
      readonly status: 'failure';
      readonly kind: RagConversationFailureKind;
      /** Final evidence admission rejected after dispatch: no opaque body may survive. */
      readonly discardUnverifiedDraft?: true;
      /** Safe retry, refresh, or evidence-review guidance for a saved-question preflight failure. */
      readonly visitQuestionRecovery?: VisitQuestionPreflightRecovery;
    }
  | { readonly status: 'unavailable' };

/** Evidence rejection is terminal for opaque UI drafts, not for independent reviews. */
export function conversationEvidenceRejectsDraft(
  outcome: RagConversationOutcome,
) {
  return (
    outcome.status === 'failure' &&
    (outcome.kind === 'stale_evidence' ||
      outcome.discardUnverifiedDraft === true)
  );
}

/** Maps closed provider error codes without copying request or provider text into UI state. */
export function providerFailureKind(
  code: ProviderErrorCode | undefined,
): RagConversationFailureKind | undefined {
  switch (code) {
    case 'authentication_required':
    case 'credential_unavailable':
      return 'provider_authentication';
    case 'rate_limited':
      return 'provider_rate_limited';
    case 'invalid_provider':
    case 'invalid_request':
    case 'unsupported_capability':
    case 'unsupported_input':
    case 'duplicate_provider':
      return 'provider_configuration';
    case 'safety_refusal':
      return 'provider_refused';
    case 'internal_error':
    case 'provider_unavailable':
      return 'provider_unavailable';
    default:
      return undefined;
  }
}

/** Converts workflow statuses to fixed recovery categories and keeps reasons private. */
export function failureFromWorkflow(
  result: Exclude<MultiAgentRunResult<GroundedRagAnswer>, { status: 'result' }>,
): RagConversationOutcome {
  if ('providerErrorCode' in result && result.providerErrorCode) {
    const kind = providerFailureKind(result.providerErrorCode);
    if (kind) return { status: 'failure', kind };
  }

  switch (result.status) {
    case 'needs_clarification':
      if (result.clarification === 'recording_selector_required')
        return { status: 'insufficient', guidance: 'recording_selector' };
      return result.message === 'No current evidence is available.'
        ? { status: 'no_evidence' }
        : { status: 'insufficient' };
    case 'consent_required':
      return { status: 'failure', kind: 'consent_required' };
    case 'cancelled':
      return { status: 'failure', kind: 'cancelled' };
    case 'invalid_output':
      return { status: 'failure', kind: 'validation_failed' };
    case 'stale_evidence':
      return { status: 'failure', kind: 'stale_evidence' };
    case 'budget_exceeded':
      return { status: 'failure', kind: 'budget_exceeded' };
    case 'unavailable':
      return { status: 'failure', kind: 'unavailable' };
    default:
      return { status: 'failure', kind: 'unavailable' };
  }
}
