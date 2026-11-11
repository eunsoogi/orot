import { invokeProductionRequest } from '@orot/agent-runtime';
import type {
  ConsentDecision,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import type { SelectedAiResolution } from './provider';
import { stableJson, utf8ByteLength } from './evidenceUtils';
import {
  providerDiagnostic,
  reportProviderException,
} from '../../providers/diagnostics';
import type { DailyReportFailureCode } from './dailyReportTypes';

type Selected = Extract<SelectedAiResolution, { status: 'ready' }>;
type Failure = Extract<
  DailyReportFailureCode,
  | 'cancelled'
  | 'timeout'
  | 'consent_required'
  | 'provider_unavailable'
  | 'source_revision_changed'
  | 'source_read_failed'
  | 'partial_stream'
  | 'malformed_output'
>;

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
  // Validation diagnostics use fixed tokens; malformed provider text stays local.
  const invalidOutput = () => {
    providerDiagnostic('daily_report', 'validation', 'invalid_output');
    return { status: 'failed' as const, code: 'malformed_output' as const };
  };
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
    if (utf8ByteLength(JSON.stringify(request)) > 64 * 1024) {
      providerDiagnostic('daily_report', 'provider_error', 'unsupported_input');
      return { status: 'failed', code: 'provider_unavailable' };
    }
    if (input.selected.remoteProcessing) {
      let decision: ConsentDecision;
      try {
        decision = await wait(
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
      } catch {
        if (controller.signal.aborted) return cancelled();
        providerDiagnostic('daily_report', 'workflow', 'consent_required');
        return { status: 'failed', code: 'consent_required' };
      }
      if (decision !== 'authorized' || stableJson(request) !== original) {
        providerDiagnostic('daily_report', 'workflow', 'consent_required');
        return { status: 'failed', code: 'consent_required' };
      }
    }
    if (controller.signal.aborted) return cancelled();
    // Consent can remain open while records change; never transmit the old snapshot.
    let current = false;
    try {
      current = await wait(input.revalidate(controller.signal));
    } catch {
      if (controller.signal.aborted) return cancelled();
      return { status: 'failed', code: 'source_read_failed' };
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
    providerDiagnostic('daily_report', 'provider_error', 'started');
    try {
      response = await wait(
        invokeProductionRequest(
          observed,
          request,
          controller.signal,
          Boolean(provider.capabilities.streaming && provider.stream),
        ),
      );
      providerDiagnostic('daily_report', 'provider_error', 'completed');
    } catch (error) {
      if (controller.signal.aborted) return cancelled();
      providerDiagnostic('daily_report', 'provider_error', 'failed');
      reportProviderException('daily_report', error);
      return {
        status: 'failed',
        code:
          sawEvent && !completed ? 'partial_stream' : 'provider_unavailable',
      };
    }
    if (response.finishReason !== 'complete' || response.toolCalls.length) {
      providerDiagnostic('daily_report', 'validation', 'invalid_output');
      return response.finishReason === 'length_limit'
        ? { status: 'failed', code: 'partial_stream' }
        : { status: 'failed', code: 'malformed_output' };
    }
    let value: unknown;
    try {
      value = response.structuredOutput ?? JSON.parse(response.text);
    } catch {
      return invalidOutput();
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).join() !== 'indexes'
    )
      return invalidOutput();
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
      return invalidOutput();
    providerDiagnostic('daily_report', 'validation', 'completed');
    return { status: 'selected', indexes };
  } catch (error) {
    if (!controller.signal.aborted) {
      providerDiagnostic('daily_report', 'provider_error', 'failed');
      reportProviderException('daily_report', error);
    }
    return controller.signal.aborted
      ? cancelled()
      : { status: 'failed', code: 'provider_unavailable' };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener('abort', stop);
    controller.abort();
  }
}
