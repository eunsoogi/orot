import { invokeProductionRequest } from '../langchain/production';
import { NativeChatModelError } from '../langchain/chatModel';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
  LanguageModelResponse,
  LanguageModelStreamEvent,
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
type LanguageModelTextEvent = Extract<
  LanguageModelStreamEvent,
  { readonly type: 'text_delta' | 'text_snapshot' }
>;

export type ObservedOperation<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'error' }
  | { readonly kind: 'cancelled' };

export function observeUntilAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<ObservedOperation<T>> {
  if (signal.aborted) {
    // Cancellation wins, but the already-started operation still needs a rejection handler.
    operation.catch(() => undefined);
    return Promise.resolve({ kind: 'cancelled' });
  }
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
  onTextEvent?: (event: LanguageModelTextEvent) => void,
): Promise<ProviderCallOutcome> {
  let providerStop: ProviderStopObservation = 'underlying_call_unconfirmed';
  const operation = invokeProductionRequest(
    provider,
    request,
    signal,
    true,
    (text) => {
      try {
        onTextEvent?.({ type: 'text_snapshot', text });
      } catch {
        // Display projection cannot interrupt response validation.
      }
    },
    () => {
      providerStop = 'iterator_return_requested';
    },
  );
  const result = await observeAdapter(operation, signal);
  return result.status === 'cancelled' ? { ...result, providerStop } : result;
}

/** Cancellation wins without claiming a provider stop that has not been observed. */
async function observeAdapter(
  operation: Promise<LanguageModelResponse>,
  signal: AbortSignal,
): Promise<ProviderCallOutcome> {
  const observed = await observeUntilAbort(
    operation.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({
        ok: false as const,
        errorCode: error instanceof NativeChatModelError ? error.code : ('internal_error' as const),
      }),
    ),
    signal,
  );
  if (observed.kind === 'cancelled')
    return { status: 'cancelled', providerStop: 'underlying_call_unconfirmed' };
  if (observed.kind === 'error') return { status: 'unavailable', errorCode: 'internal_error' };
  return observed.value.ok
    ? { status: 'response', response: observed.value.value }
    : { status: 'unavailable', errorCode: observed.value.errorCode };
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
  onTextEvent?: (event: LanguageModelTextEvent) => void,
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
          ...(execution.consentScope ? { consentScope: execution.consentScope } : {}),
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
  const guided = request.responseFormat !== undefined || Boolean(request.tools?.length);
  const canStreamGuidedResponse =
    provider.capabilities.structuredOutputStreaming !== false &&
    (provider.capabilities.structuredOutputStreaming !== true || onTextEvent !== undefined);
  if (provider.capabilities.streaming && provider.stream && (!guided || canStreamGuidedResponse)) {
    const startedAt = Date.now();
    let result: ProviderCallOutcome;
    try {
      result = await collectStream(provider, request, signal, onTextEvent);
    } catch {
      result = { status: 'unavailable', errorCode: 'internal_error' };
    }
    recordTelemetry(telemetry, 'language-model.stream', startedAt, result);
    return result;
  }
  const startedAt = Date.now();
  let result: ProviderCallOutcome;
  try {
    result = await observeAdapter(invokeProductionRequest(provider, request, signal), signal);
  } catch {
    result = { status: 'unavailable', errorCode: 'internal_error' };
  }
  recordTelemetry(telemetry, 'language-model.generate', startedAt, result);
  return result;
}
