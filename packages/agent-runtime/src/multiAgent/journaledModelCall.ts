import type { LanguageModelRequest, LanguageModelStreamEvent } from '@orot/model-runtime';
import type { ExecutionConsentPort } from './contracts';
import { referencesFromBatch } from './evidence';
import { authorizeModelCall } from './modelAuthorization';
import { callModel, dispatchAuthorizedModelCall, type ModelCallOutcome } from './modelCall';
import { canonicalJson } from './protocol';
import type { RuntimeContext } from './runtimeContext';

class AuthorizationPaused extends Error {}
export function isAuthorizationPaused(error: unknown): boolean {
  return error instanceof AuthorizationPaused;
}

function restoredOutcome(raw: string): ModelCallOutcome | undefined {
  try {
    const value = JSON.parse(raw);
    if (
      value?.status === 'response' &&
      typeof value.response?.text === 'string' &&
      Array.isArray(value.response.toolCalls) &&
      typeof value.response.finishReason === 'string'
    ) {
      return value;
    }
  } catch {
    /* Corrupt private journal data never authorizes another remote operation. */
  }
  return undefined;
}

/** Replays only completed exact calls; authorization is fresh and never part of a saved result. */
export async function journaledModelCall<TResult>(
  context: RuntimeContext<TResult>,
  request: LanguageModelRequest,
  consent: ExecutionConsentPort,
  onTextEvent?: (
    event: Extract<LanguageModelStreamEvent, { type: 'text_delta' | 'text_snapshot' }>,
  ) => void,
  prepare?: (signal: AbortSignal) => Promise<ModelCallOutcome | 'ready' | undefined>,
): Promise<ModelCallOutcome | undefined> {
  const { options, signal, activeModelOperation: operation } = context;
  const journal = options.operationJournal;
  if (!journal || !operation) {
    const prepared = prepare ? await prepare(signal) : 'ready';
    if (prepared !== 'ready') return prepared;
    return callModel(
      options.provider,
      request,
      options.execution,
      consent,
      signal,
      undefined,
      onTextEvent,
    );
  }
  const identity = {
    operationId: `${operation.operationKey}:call-${++operation.callIndex}`,
    input: canonicalJson({ request, execution: options.execution }),
    evidenceReferences: referencesFromBatch(context.currentEvidence),
  };
  const record = await journal.loadOrCreate(identity);
  if (signal.aborted) return { status: 'cancelled', providerStop: 'not_started' };
  if (record.status === 'completed') {
    // The adapter and caller source fence both revalidate evidence before completed values are used.
    return (
      restoredOutcome(record.result) ?? { status: 'unavailable', errorCode: 'invalid_request' }
    );
  }
  if (record.status !== 'ready') return { status: 'unavailable', errorCode: 'invalid_request' };
  const approval = context.pause?.approvalSignal(signal);
  const approvalSignal = approval?.signal ?? signal;
  const notify = (waiting: boolean) => {
    try {
      context.onApprovalWait?.(waiting);
    } catch {
      /* UI observers cannot grant access. */
    }
  };
  try {
    notify(Boolean(context.pause && options.checkpointer));
    const prepared = prepare ? await prepare(approvalSignal) : 'ready';
    if (approvalSignal.aborted && !signal.aborted && options.checkpointer)
      throw new AuthorizationPaused();
    if (prepared !== 'ready') return prepared;
    const grant = await authorizeModelCall(request, options.execution, consent, approvalSignal);
    approval?.finishApproval();
    notify(false);
    if (grant.status !== 'authorized') {
      // No intent has been written and no provider has been called for this operation.
      if (approvalSignal.aborted && !signal.aborted && options.checkpointer) {
        throw new AuthorizationPaused();
      }
      return grant;
    }
    if (signal.aborted) return { status: 'cancelled', providerStop: 'not_started' };
    const claimed = await journal.begin({ ...identity, revision: record.revision });
    if (claimed.status !== 'claimed')
      return { status: 'unavailable', errorCode: 'invalid_request' };
    const outcome = await dispatchAuthorizedModelCall(
      options.provider,
      request,
      options.execution,
      grant,
      approvalSignal,
      undefined,
      onTextEvent,
    );
    if (outcome.status === 'response') {
      const stored = await journal.complete({
        ...identity,
        claim: claimed.claim,
        result: JSON.stringify(outcome),
      });
      if (!stored) return { status: 'unavailable', errorCode: 'invalid_request' };
    }
    // Any unconfirmed failure leaves the durable intent untouched and cannot be replayed.
    return outcome;
  } finally {
    notify(false);
    approval?.dispose();
  }
}
