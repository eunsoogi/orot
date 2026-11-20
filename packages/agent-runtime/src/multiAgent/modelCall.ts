import { guardProviderAuthorization } from './authorizedProvider';
import { observeModelStage, type ModelStageObserver } from './modelStageDiagnostics';
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
import { authorizeModelCall, type ModelAuthorizationGrant } from './modelAuthorization';
import { observeUntilAbort } from './operationObservation';
export { observeUntilAbort, type ObservedOperation } from './operationObservation';

export type ModelCallOutcome =
  | { readonly status: 'response'; readonly response: LanguageModelResponse }
  | { readonly status: 'cancelled'; readonly providerStop: ProviderStopObservation }
  | { readonly status: 'consent_required' }
  | { readonly status: 'budget_exceeded' }
  | { readonly status: 'unavailable'; readonly errorCode: ProviderErrorCode };

// Consent and payload-budget failures happen before the provider is invoked.
type ProviderCallOutcome = Exclude<
  ModelCallOutcome,
  { readonly status: 'consent_required' | 'budget_exceeded' }
>;
type LanguageModelTextEvent = Extract<
  LanguageModelStreamEvent,
  { readonly type: 'text_delta' | 'text_snapshot' }
>;

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
  onModelStage?: ModelStageObserver,
): Promise<ModelCallOutcome> {
  const authorization = await authorizeModelCall(request, execution, consent, signal);
  if (authorization.status !== 'authorized') return authorization;
  return dispatchAuthorizedModelCall(
    provider,
    request,
    execution,
    authorization,
    signal,
    telemetry,
    onTextEvent,
    onModelStage,
  );
}

/** Called only after the caller has durably recorded dispatch intent, when journaling is active. */
export async function dispatchAuthorizedModelCall(
  provider: LanguageModelProvider,
  request: LanguageModelRequest,
  execution: MultiAgentExecutionIdentity,
  authorization: ModelAuthorizationGrant,
  signal: AbortSignal,
  telemetry?: TelemetrySink,
  onTextEvent?: (event: LanguageModelTextEvent) => void,
  onModelStage?: ModelStageObserver,
): Promise<ModelCallOutcome> {
  // The grant is invocation-local, single use, and bound to the unchanged exact payload.
  if (!authorization.consume(request, execution, signal)) {
    return signal.aborted
      ? { status: 'cancelled', providerStop: 'not_started' }
      : { status: 'consent_required' };
  }
  const guarded = guardProviderAuthorization(
    provider,
    () => authorization.isCurrent(),
    (listener) => authorization.subscribeInvalidation(listener),
  );
  return observeModelStage(onModelStage, 'provider_wait', async (): Promise<ModelCallOutcome> => {
    const guided = request.responseFormat !== undefined || Boolean(request.tools?.length);
    const canStreamGuidedResponse =
      provider.capabilities.structuredOutputStreaming !== false &&
      (provider.capabilities.structuredOutputStreaming !== true || onTextEvent !== undefined);
    if (
      provider.capabilities.streaming &&
      provider.stream &&
      (!guided || canStreamGuidedResponse)
    ) {
      const startedAt = Date.now();
      let result: ProviderCallOutcome;
      try {
        result = await collectStream(guarded.provider, request, signal, onTextEvent);
      } catch {
        result = { status: 'unavailable', errorCode: 'internal_error' };
      }
      if (guarded.wasDenied()) return { status: 'consent_required' };
      recordTelemetry(telemetry, 'language-model.stream', startedAt, result);
      return result;
    }
    const startedAt = Date.now();
    let result: ProviderCallOutcome;
    try {
      result = await observeAdapter(
        invokeProductionRequest(guarded.provider, request, signal),
        signal,
      );
    } catch {
      result = { status: 'unavailable', errorCode: 'internal_error' };
    }
    if (guarded.wasDenied()) return { status: 'consent_required' };
    recordTelemetry(telemetry, 'language-model.generate', startedAt, result);
    return result;
  });
}
