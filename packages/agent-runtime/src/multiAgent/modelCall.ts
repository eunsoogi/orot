import type {
  LanguageModelProvider,
  LanguageModelRequest,
  LanguageModelResponse,
  ProviderErrorCode,
  TelemetryEvent,
  TelemetryOperation,
  TelemetrySink,
} from '@orot/model-runtime';
import type {
  MultiAgentExecutionIdentity,
  ExecutionConsentPort,
  ProviderStopObservation,
} from './contracts';
import { utf8ByteLength } from './protocol';

export type ModelCallOutcome =
  | { readonly status: 'response'; readonly response: LanguageModelResponse }
  | { readonly status: 'cancelled'; readonly providerStop: ProviderStopObservation }
  | { readonly status: 'consent_required' }
  | { readonly status: 'unavailable'; readonly errorCode: ProviderErrorCode };

type ProviderCallOutcome = Exclude<ModelCallOutcome, { readonly status: 'consent_required' }>;

export type ObservedOperation<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'error' }
  | { readonly kind: 'cancelled' };

export function observeUntilAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<ObservedOperation<T>> {
  if (signal.aborted) return Promise.resolve({ kind: 'cancelled' });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ObservedOperation<T>) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ kind: 'cancelled' });
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish({ kind: 'value', value }),
      () => finish({ kind: 'error' }),
    );
  });
}

function serializedRequest(request: LanguageModelRequest): string | undefined {
  try {
    return JSON.stringify(request);
  } catch {
    return undefined;
  }
}

// Returning an iterator is only a stop request; providers expose no stronger cancellation proof.
async function collectStream(
  provider: LanguageModelProvider,
  request: LanguageModelRequest,
  signal: AbortSignal,
): Promise<ProviderCallOutcome> {
  const iterator = provider.stream!(request)[Symbol.asyncIterator]();
  const operation = (async () => {
    let response: LanguageModelResponse | undefined;
    while (true) {
      const next = await iterator.next();
      if (signal.aborted) return undefined;
      if (next.done) break;
      if (!next.value.ok) return { ok: false as const, errorCode: next.value.error.code };
      if (next.value.value.type === 'completed') response = next.value.value.response;
    }
    return response
      ? { ok: true as const, value: response }
      : { ok: false as const, errorCode: 'internal_error' as const };
  })();
  const observed = await observeUntilAbort(operation, signal);
  if (observed.kind === 'cancelled') {
    let providerStop: ProviderStopObservation = 'underlying_call_unconfirmed';
    try {
      if (iterator.return) {
        Promise.resolve(iterator.return()).catch(() => undefined);
        providerStop = 'iterator_return_requested';
      }
    } catch {
      providerStop = 'underlying_call_unconfirmed';
    }
    return { status: 'cancelled', providerStop };
  }
  if (observed.kind === 'error') {
    return { status: 'unavailable', errorCode: 'internal_error' };
  }
  if (!observed.value?.ok) {
    return { status: 'unavailable', errorCode: observed.value?.errorCode ?? 'internal_error' };
  }
  return { status: 'response', response: observed.value.value };
}

function recordTelemetry(
  sink: TelemetrySink | undefined,
  operation: TelemetryOperation,
  startedAt: number,
  result: ProviderCallOutcome,
): void {
  if (!sink) return;
  const event: TelemetryEvent = {
    operation,
    outcome:
      result.status === 'response'
        ? 'success'
        : result.status === 'cancelled'
          ? 'cancelled'
          : 'error',
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(result.status === 'unavailable' ? { errorCode: result.errorCode } : {}),
  };
  try {
    const pending = sink.record(event);
    if (pending && typeof pending.then === 'function') {
      Promise.resolve(pending).catch(() => undefined);
    }
  } catch {
    // A sink is best-effort and never receives or logs the request itself.
  }
}

// Consent and payload bounds are checked on the exact request immediately before provider use.
export async function callModel(
  provider: LanguageModelProvider,
  request: LanguageModelRequest,
  execution: MultiAgentExecutionIdentity,
  consent: ExecutionConsentPort,
  signal: AbortSignal,
  telemetry?: TelemetrySink,
): Promise<ModelCallOutcome> {
  if (signal.aborted) return { status: 'cancelled', providerStop: 'not_started' };
  const consentSnapshot = serializedRequest(request);
  if (
    consentSnapshot === undefined ||
    utf8ByteLength(consentSnapshot) > execution.budget.maxPayloadBytes
  ) {
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
          allowedScope: execution.allowedScope,
          payload: request,
          signal,
        }),
        signal,
      );
      if (approval.kind === 'cancelled') {
        return { status: 'cancelled', providerStop: 'not_started' };
      }
      if (approval.kind === 'error') return { status: 'consent_required' };
      if (approval.value !== 'authorized') return { status: 'consent_required' };
      if (serializedRequest(request) !== consentSnapshot) return { status: 'consent_required' };
    } catch {
      return { status: 'consent_required' };
    }
  }
  if (signal.aborted) return { status: 'cancelled', providerStop: 'not_started' };
  if (provider.capabilities.streaming && provider.stream) {
    const startedAt = Date.now();
    let result: ProviderCallOutcome;
    try {
      result = await collectStream(provider, request, signal);
    } catch {
      result = { status: 'unavailable', errorCode: 'internal_error' };
    }
    recordTelemetry(telemetry, 'language-model.stream', startedAt, result);
    return result;
  }
  const startedAt = Date.now();
  let result: ProviderCallOutcome;
  try {
    const observed = await observeUntilAbort(provider.generate(request), signal);
    if (observed.kind === 'cancelled') {
      result = { status: 'cancelled', providerStop: 'underlying_call_unconfirmed' };
    } else if (observed.kind === 'error') {
      result = { status: 'unavailable', errorCode: 'internal_error' };
    } else if (!observed.value.ok) {
      result = { status: 'unavailable', errorCode: observed.value.error.code };
    } else {
      result = { status: 'response', response: observed.value.value };
    }
  } catch {
    result = { status: 'unavailable', errorCode: 'internal_error' };
  }
  recordTelemetry(telemetry, 'language-model.generate', startedAt, result);
  return result;
}
