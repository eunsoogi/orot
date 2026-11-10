import { invokeProductionRequest } from '@orot/agent-runtime';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import type { SelectedAiResolution } from './provider';
import { stableJson, utf8ByteLength } from './evidenceUtils';

type Selected = Extract<SelectedAiResolution, { status: 'ready' }>;
type Failure =
  | 'cancelled'
  | 'timeout'
  | 'consent_required'
  | 'provider_unavailable'
  | 'source_revision_changed'
  | 'partial_stream'
  | 'malformed_output';

/** The exact approved payload is dispatched once; late provider results never become a completion. */
export async function selectDailyReportFacts(input: {
  selected: Selected;
  consent: ExecutionConsentPort;
  runId: string;
  facts: readonly { text: string }[];
  signal: AbortSignal;
  timeoutMs: number;
  revalidate: (signal: AbortSignal) => Promise<boolean>;
}): Promise<
  | { status: 'selected'; indexes: number[] }
  | { status: 'failed'; code: Failure }
> {
  if (input.signal.aborted) return { status: 'failed', code: 'cancelled' };
  const controller = new AbortController();
  let timeout = false;
  const stop = () => controller.abort();
  input.signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => {
    timeout = true;
    stop();
  }, input.timeoutMs);
  const request: LanguageModelRequest = {
    messages: [
      {
        role: 'system',
        content:
          'Select up to eight representative recorded facts. Return only JSON {"indexes":[0,...]}; use exact zero-based indexes, never create facts or interpretations.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          input.facts.map((fact, index) => ({ index, text: fact.text })),
        ),
      },
    ],
  };
  const original = stableJson(request);
  const cancelled = () => ({
    status: 'failed' as const,
    code: timeout ? ('timeout' as const) : ('cancelled' as const),
  });
  const wait = <T>(operation: Promise<T>) =>
    Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new Error('cancelled'));
        else
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          );
      }),
    ]);
  try {
    if (utf8ByteLength(JSON.stringify(request)) > 64 * 1024)
      return { status: 'failed', code: 'provider_unavailable' };
    if (input.selected.remoteProcessing) {
      const decision = await wait(
        input.consent.authorize({
          operationRunId: input.runId,
          providerId: input.selected.provider.id,
          modelId: input.selected.modelId,
          recipient: input.selected.recipient,
          remoteProcessing: true,
          consentScope: {
            purpose: 'daily_report',
            dataCategories: ['health_records'],
            policyVersion: 'daily-report-v1',
          },
          allowedScope: { sourceKinds: ['personal_record'] },
          payload: request,
          signal: controller.signal,
        }),
      );
      if (decision !== 'authorized' || stableJson(request) !== original)
        return { status: 'failed', code: 'consent_required' };
    }
    if (controller.signal.aborted) return cancelled();
    // Consent can remain open while records change; never transmit the old snapshot.
    let current = false;
    try {
      current = await wait(input.revalidate(controller.signal));
    } catch {
      if (controller.signal.aborted) return cancelled();
    }
    if (!current) return { status: 'failed', code: 'source_revision_changed' };
    if (controller.signal.aborted) return cancelled();
    if (stableJson(request) !== original)
      return { status: 'failed', code: 'consent_required' };
    let sawEvent = false;
    let completed = false;
    const provider = input.selected.provider;
    const observed: LanguageModelProvider = {
      ...provider,
      generate: (wire, options) => provider.generate(wire, options),
      ...(provider.stream
        ? {
            async *stream(req, options) {
              for await (const event of provider.stream!(req, options)) {
                if (
                  event.ok &&
                  (event.value.type === 'text_delta' ||
                    event.value.type === 'text_snapshot')
                )
                  sawEvent = true;
                if (event.ok && event.value.type === 'completed')
                  completed = true;
                yield event;
              }
            },
          }
        : {}),
    };
    let response;
    try {
      response = await wait(
        invokeProductionRequest(
          observed,
          request,
          controller.signal,
          Boolean(provider.capabilities.streaming && provider.stream),
        ),
      );
    } catch {
      if (controller.signal.aborted) return cancelled();
      return {
        status: 'failed',
        code:
          sawEvent && !completed ? 'partial_stream' : 'provider_unavailable',
      };
    }
    if (response.finishReason !== 'complete' || response.toolCalls.length)
      return {
        status: 'failed',
        code:
          response.finishReason === 'length_limit'
            ? 'partial_stream'
            : 'malformed_output',
      };
    let value: unknown;
    try {
      value = response.structuredOutput ?? JSON.parse(response.text);
    } catch {
      return { status: 'failed', code: 'malformed_output' };
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).join() !== 'indexes'
    )
      return { status: 'failed', code: 'malformed_output' };
    const indexes = (value as { indexes: unknown }).indexes;
    if (
      !Array.isArray(indexes) ||
      !indexes.length ||
      indexes.length > 8 ||
      indexes.some(
        index =>
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= input.facts.length,
      ) ||
      new Set(indexes).size !== indexes.length
    )
      return { status: 'failed', code: 'malformed_output' };
    return { status: 'selected', indexes };
  } catch {
    return controller.signal.aborted
      ? cancelled()
      : { status: 'failed', code: 'consent_required' };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener('abort', stop);
    controller.abort();
  }
}
