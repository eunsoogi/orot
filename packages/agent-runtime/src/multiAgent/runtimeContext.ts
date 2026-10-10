import type { JsonObject, ProviderErrorCode } from '@orot/model-runtime';
import type {
  EvidenceBatch,
  EvidenceReference,
  MultiAgentWorkflowOptions,
  ProviderStopObservation,
} from './contracts';

export type FailureStatus =
  | 'needs_clarification'
  | 'unavailable'
  | 'invalid_output'
  | 'budget_exceeded'
  | 'consent_required'
  | 'stale_evidence';

export type PrivateOutcome<TResult> =
  | { readonly status: 'result'; readonly value: TResult; readonly citations: EvidenceReference[] }
  | {
      readonly status: 'needs_clarification';
      readonly reason: string;
      /** Only task validation supplies display copy; other clarifications remain generic. */
      readonly message?: string;
      readonly providerErrorCode?: ProviderErrorCode;
      readonly coverage?: EvidenceBatch['coverage'];
    }
  | {
      readonly status: Exclude<FailureStatus, 'needs_clarification'>;
      readonly reason: string;
      readonly providerErrorCode?: ProviderErrorCode;
      readonly coverage?: EvidenceBatch['coverage'];
    }
  | { readonly status: 'cancelled'; readonly providerStop: ProviderStopObservation };

export interface RuntimeContext<TResult> {
  readonly options: MultiAgentWorkflowOptions<TResult>;
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  currentEvidence: EvidenceBatch;
  researchInput?: JsonObject;
  outcome?: PrivateOutcome<TResult>;
}

export function stop<TResult>(
  context: RuntimeContext<TResult>,
  reason: string,
  status: FailureStatus = 'needs_clarification',
): void {
  context.outcome = { status, reason };
}

export function canceled<TResult>(
  context: RuntimeContext<TResult>,
  providerStop: ProviderStopObservation = 'not_started',
): void {
  if (context.outcome?.status === 'cancelled') return;
  context.outcome = context.timedOut()
    ? { status: 'budget_exceeded', reason: 'The run exceeded its time limit.' }
    : { status: 'cancelled', providerStop };
}

export function completeState() {
  return { phase: 'complete' as const, pendingOperation: undefined, terminal: true };
}

export function operationKey(kind: 'model' | 'tool', number: number): string {
  return `${kind}-${number}`;
}
