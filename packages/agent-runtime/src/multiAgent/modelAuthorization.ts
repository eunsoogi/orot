import { isExecutionConsentCurrent } from './consentCurrentness';
import { executionLimit } from './executionLimits';
import type { LanguageModelRequest } from '@orot/model-runtime';
import type {
  ExecutionConsentPort,
  MultiAgentExecutionIdentity,
  OutboundProcessingRequest,
} from './contracts';
import { observeUntilAbort } from './operationObservation';
import { utf8ByteLength } from './protocol';

/** A grant is a live capability, never a checkpoint value or a reusable approval decision. */
export interface ModelAuthorizationGrant {
  readonly status: 'authorized';
  /** Rechecks the live boundary after adapter awaits; never creates a second grant. */
  isCurrent(): boolean;
  subscribeInvalidation(listener: () => void): () => void;
  consume(
    request: LanguageModelRequest,
    execution: MultiAgentExecutionIdentity,
    signal: AbortSignal,
  ): boolean;
}

export type ModelAuthorizationResult =
  | ModelAuthorizationGrant
  | { readonly status: 'cancelled'; readonly providerStop: 'not_started' }
  | { readonly status: 'consent_required' }
  | { readonly status: 'budget_exceeded' }
  | { readonly status: 'unavailable'; readonly errorCode: 'invalid_request' };

function snapshot(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Authorization has no provider side effect. Dispatch must consume a fresh matching grant. */
export async function authorizeModelCall(
  request: LanguageModelRequest,
  execution: MultiAgentExecutionIdentity,
  consent: ExecutionConsentPort,
  signal: AbortSignal,
): Promise<ModelAuthorizationResult> {
  if (signal.aborted) return { status: 'cancelled', providerStop: 'not_started' };
  const payload = snapshot(request);
  const identity = snapshot(execution);
  if (!payload || !identity) {
    return { status: 'unavailable', errorCode: 'invalid_request' };
  }
  // A local size limit is not an account/provider configuration failure. Reject before consent or dispatch.
  const limit =
    execution.budget.maxModelRequestBytes === undefined
      ? executionLimit(execution.budget, 'maxPayloadBytes')
      : execution.budget.maxModelRequestBytes;
  if (
    execution.budget.executionLimits !== 'unbounded' &&
    limit !== null &&
    utf8ByteLength(payload) > limit
  )
    return { status: 'budget_exceeded' };
  const outbound: OutboundProcessingRequest = {
    operationRunId: execution.operationRunId,
    providerId: execution.providerId,
    modelId: execution.modelId,
    recipient: execution.recipient,
    remoteProcessing: execution.remoteProcessing,
    ...(execution.consentScope ? { consentScope: execution.consentScope } : {}),
    allowedScope: execution.allowedScope,
    payload: request,
    signal,
  };
  if (execution.remoteProcessing) {
    try {
      const approval = await observeUntilAbort(consent.authorize(outbound), signal);
      if (approval.kind === 'cancelled')
        return { status: 'cancelled', providerStop: 'not_started' };
      if (approval.kind !== 'value' || approval.value !== 'authorized') {
        return { status: 'consent_required' };
      }
    } catch {
      return { status: 'consent_required' };
    }
  }
  if (signal.aborted) return { status: 'cancelled', providerStop: 'not_started' };
  if (snapshot(request) !== payload || snapshot(execution) !== identity) {
    return { status: 'consent_required' };
  }
  let consumed = false;
  let invalid = false;
  const current = () => {
    if (invalid) return false;
    const valid =
      !signal.aborted &&
      snapshot(request) === payload &&
      snapshot(execution) === identity &&
      isExecutionConsentCurrent(consent, outbound);
    if (!valid) invalid = true;
    return valid;
  };
  return {
    status: 'authorized',
    isCurrent: current,
    subscribeInvalidation(listener) {
      try {
        const stop = consent.subscribeAuthorizationInvalidation?.(outbound, listener) ?? (() => {});
        if (!current()) listener();
        return stop;
      } catch {
        listener();
        return () => {};
      }
    },
    consume: (currentRequest, currentExecution, currentSignal) => {
      const available = !consumed;
      consumed = true;
      const valid =
        available &&
        currentSignal === signal &&
        !currentSignal.aborted &&
        snapshot(currentRequest) === payload &&
        snapshot(currentExecution) === identity &&
        current();
      if (!valid) invalid = true;
      return valid;
    },
  };
}
