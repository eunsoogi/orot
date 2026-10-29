import type { MultiAgentRunResult } from '@orot/agent-runtime';
import type { ProviderErrorCode } from '@orot/model-runtime';
import type { GroundedRagAnswer } from './task';

export type RagConversationFailureKind =
  | 'provider_authentication'
  | 'provider_rate_limited'
  | 'provider_configuration'
  | 'provider_refused'
  | 'provider_unavailable'
  | 'consent_required'
  | 'cancelled'
  | 'retrieval_failed'
  | 'validation_failed'
  | 'stale_evidence'
  | 'budget_exceeded'
  | 'unavailable';

export type RagConversationOutcome =
  | { readonly status: 'no_evidence' }
  | {
      readonly status: 'answer';
      readonly answer: string;
      readonly citations: readonly import('@orot/agent-runtime').EvidenceReference[];
    }
  | { readonly status: 'insufficient' }
  | {
      readonly status: 'failure';
      readonly kind: RagConversationFailureKind;
    }
  | { readonly status: 'unavailable' };

/** Maps closed provider error codes without copying request or provider text into UI state. */
function providerFailureKind(
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
