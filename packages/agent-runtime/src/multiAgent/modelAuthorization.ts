import type { LanguageModelRequest } from '@orot/model-runtime';
import type { ExecutionConsentPort, MultiAgentExecutionIdentity } from './contracts';
import { observeUntilAbort } from './operationObservation';
import { utf8ByteLength } from './protocol';

/** A grant is a live capability, never a checkpoint value or a reusable approval decision. */
export interface ModelAuthorizationGrant {
  readonly status: 'authorized';
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
  if (!payload || !identity || utf8ByteLength(payload) > execution.budget.maxPayloadBytes) {
    return { status: 'unavailable', errorCode: 'invalid_request' };
  }
  if (execution.remoteProcessing) {
    try {
      const approval = await observeUntilAbort(
        consent.authorize({
          operationRunId: execution.operationRunId,
          providerId: execution.providerId,
          modelId: execution.modelId,
          recipient: execution.recipient,
          remoteProcessing: true,
          ...(execution.consentScope ? { consentScope: execution.consentScope } : {}),
          allowedScope: execution.allowedScope,
          payload: request,
          signal,
        }),
        signal,
      );
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
  return {
    status: 'authorized',
    consume: (currentRequest, currentExecution, currentSignal) => {
      const available = !consumed;
      consumed = true;
      return (
        available &&
        !signal.aborted &&
        !currentSignal.aborted &&
        currentSignal === signal &&
        snapshot(currentRequest) === payload &&
        snapshot(currentExecution) === identity
      );
    },
  };
}
