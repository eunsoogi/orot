import { dailyReportConsentRequest } from './dailyReportConsentRequest';
import * as reportAuth from './dailyReportAuthorizationWait';
import { dailyReportModelPrompt } from './dailyReportModelPrompt';
import {
  parseReportModelResponse,
  type ReportModelFact,
  type ReportModelContext,
  type ReportModelAnalysis,
} from './dailyReportModelAnalysis';
import {
  guardProviderAuthorization,
  invokeProductionRequest,
  isExecutionConsentCurrent,
} from '@orot/agent-runtime';
import type {
  ConsentDecision,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import type { SelectedAiResolution } from './provider';
import { stableJson } from './evidenceUtils';
import {
  providerDiagnostic,
  reportProviderException,
} from '../../providers/diagnostics';
import type {
  DailyReportDeadlineContext,
  DailyReportModelFailureCode as Failure,
} from './dailyReportTypes';
type Selected = Extract<SelectedAiResolution, { status: 'ready' }>;
/** The exact approved payload is dispatched once; late provider results never become a completion. */
export async function selectDailyReportFacts(input: {
  selected: Selected;
  consent: ExecutionConsentPort;
  runId: string;
  facts: readonly ReportModelFact[];
  allowAnalysis?: boolean;
  reportContext?: ReportModelContext;
  includesSystemCalendar?: boolean;
  signal: AbortSignal;
  timeoutMs: number | null;
  deadlineContext: DailyReportDeadlineContext;
  revalidate: (signal: AbortSignal) => Promise<boolean>;
}): Promise<
  | { status: 'selected'; indexes: number[]; analysis: ReportModelAnalysis[] }
  | { status: 'failed'; code: Failure }
> {
  if (input.signal.aborted) return { status: 'failed', code: 'cancelled' };
  input.deadlineContext.stage = 'workflow';
  const controller = new AbortController();
  let timeout = false;
  const stop = () => controller.abort();
  input.signal.addEventListener('abort', stop, { once: true });
  const timer = reportAuth.reportProcessingDeadline(
    input.deadlineContext,
    () => {
      timeout = true;
      stop();
    },
    input.timeoutMs,
  );
  const request: LanguageModelRequest = {
    messages: [
      {
        role: 'system',
        content: dailyReportModelPrompt(input.allowAnalysis !== false),
      },
      {
        role: 'user',
        content: JSON.stringify({
          context: input.reportContext,
          facts: input.facts.map((fact, index) => ({
            index,
            text: fact.text,
            role: fact.role ?? 'evidence',
          })),
        }),
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
  const outbound = dailyReportConsentRequest(
    input.selected,
    input.runId,
    input.includesSystemCalendar === true,
    request,
    controller.signal,
  );
  const consentCurrent = () =>
    !input.selected.remoteProcessing ||
    isExecutionConsentCurrent(input.consent, outbound);
  try {
    // Capacity belongs to the selected provider; exact-payload consent and source
    // revalidation still precede dispatch regardless of request size.
    if (input.selected.remoteProcessing) {
      input.deadlineContext.stage = 'consent';
      let decision: ConsentDecision;
      try {
        decision = await wait(
          reportAuth
            .reportConsent(input.consent, input.deadlineContext)
            .authorize(outbound),
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
    input.deadlineContext.stage = 'source_read';
    let current = false;
    try {
      current = await wait(input.revalidate(controller.signal));
    } catch {
      if (controller.signal.aborted) return cancelled();
      return { status: 'failed', code: 'source_read_failed' };
    }
    if (!current) return { status: 'failed', code: 'source_revision_changed' };
    if (controller.signal.aborted) return cancelled();
    if (stableJson(request) !== original || !consentCurrent())
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
    const guarded = guardProviderAuthorization(
      observed,
      () =>
        !controller.signal.aborted &&
        stableJson(request) === original &&
        consentCurrent(),
      listener =>
        input.consent.subscribeAuthorizationInvalidation?.(
          outbound,
          listener,
        ) ?? (() => {}),
    );
    let response;
    input.deadlineContext.stage = 'provider';
    providerDiagnostic('daily_report', 'provider_error', 'started');
    try {
      response = await wait(
        invokeProductionRequest(
          guarded.provider,
          request,
          controller.signal,
          Boolean(provider.capabilities.streaming && provider.stream),
        ),
      );
      providerDiagnostic('daily_report', 'provider_error', 'completed');
    } catch (error) {
      if (controller.signal.aborted) return cancelled();
      if (guarded.wasDenied())
        return { status: 'failed', code: 'consent_required' };
      providerDiagnostic('daily_report', 'provider_error', 'failed');
      reportProviderException('daily_report', error);
      return {
        status: 'failed',
        code:
          sawEvent && !completed ? 'partial_stream' : 'provider_unavailable',
      };
    }
    input.deadlineContext.stage = 'validation';
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
    const parsed = parseReportModelResponse(
      value,
      input.facts,
      input.allowAnalysis !== false,
    );
    if (!parsed) return invalidOutput();
    providerDiagnostic('daily_report', 'validation', 'completed');
    input.deadlineContext.stage = 'workflow';
    return { status: 'selected', ...parsed };
  } catch (error) {
    if (!controller.signal.aborted) {
      providerDiagnostic('daily_report', 'provider_error', 'failed');
      reportProviderException('daily_report', error);
    }
    return controller.signal.aborted
      ? cancelled()
      : { status: 'failed', code: 'provider_unavailable' };
  } finally {
    timer.dispose();
    input.signal.removeEventListener('abort', stop);
    controller.abort();
  }
}
