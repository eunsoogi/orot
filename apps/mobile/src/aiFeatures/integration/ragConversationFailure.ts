import type { RagConversationOutcome } from '../../ragConversation/service';
import { AiProviderSelectionError } from './provider';

/** Preserve the failed boundary without exposing provider error details. */
export function ragConversationFailure(
  error: unknown,
  signal: AbortSignal,
  stage: 'selection' | 'data' | 'workflow',
): RagConversationOutcome {
  if (signal.aborted || (error instanceof Error && error.name === 'AbortError'))
    return { status: 'failure', kind: 'cancelled' };
  if (error instanceof AiProviderSelectionError)
    return {
      status: 'failure',
      kind:
        error.status === 'selection-required'
          ? 'provider_configuration'
          : 'provider_unavailable',
    };
  return {
    status: 'failure',
    kind:
      stage === 'data'
        ? 'retrieval_failed'
        : stage === 'selection'
          ? 'provider_unavailable'
          : 'unavailable',
  };
}
