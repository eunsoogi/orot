import {
  createDailyReportCalendarWindow,
  currentDailyReportContextRequest,
} from '../../healthEvidence/healthContext/dailyReportWindow';
import { providerDiagnostic } from '../../providers/diagnostics';
import { stableJson } from './evidenceUtils';
import { generateDailyReport } from './dailyReportGeneration';
import { reportFailureOutcome } from './dailyReportFailureDiagnostics';
import type {
  DailyReportFailureCode,
  DailyReportRunInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';

/** Checks the selected report identity before delegating new generation. */
export async function runDailyReport(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
) {
  const fail = (code: DailyReportFailureCode) => {
    // A timed-out operation also aborts its child signal; keep that cleanup from logging a user cancel.
    if (!input.deadlineContext.timedOut)
      providerDiagnostic(
        'daily_report',
        'workflow',
        reportFailureOutcome(code),
      );
    return { status: 'failed' as const, code };
  };
  input.deadlineContext.stage = 'workflow';
  providerDiagnostic('daily_report', 'workflow', 'started');
  if (request.signal.aborted) return fail('cancelled');
  if (request.scope.timeRange) return fail('invalid_context');
  const requested = currentDailyReportContextRequest(
    input.now(),
    request.timeZone,
  );
  if (requested.status !== 'ready') return fail('invalid_context');
  const calendar = createDailyReportCalendarWindow(requested.request);
  if (calendar.status !== 'ready') return fail('invalid_context');

  input.deadlineContext.stage = 'report_read';
  providerDiagnostic('daily_report', 'persistence', 'started');
  let existing: Awaited<ReturnType<typeof input.storage.lookup>>;
  try {
    existing = await input.storage.lookup(calendar.context.identity);
  } catch {
    if (request.signal.aborted) return fail('cancelled');
    providerDiagnostic('daily_report', 'persistence', 'failed');
    return fail('report_read_failed');
  }
  if (request.signal.aborted) return fail('cancelled');
  if (existing.status === 'error') {
    providerDiagnostic('daily_report', 'persistence', 'failed');
    return fail('report_read_failed');
  }
  providerDiagnostic('daily_report', 'persistence', 'completed');
  input.deadlineContext.stage = 'workflow';

  if (request.mode.kind === 'reuse_or_generate') {
    if (existing.status === 'saved') {
      if (request.scope.sourceIds) {
        const priorWindow = createDailyReportCalendarWindow({
          localDate: existing.context.identity.localDate,
          timeZone: existing.context.identity.timeZone,
          requestedAt: existing.context.generationCutoff,
        });
        if (priorWindow.status !== 'ready') return fail('invalid_context');
        input.deadlineContext.stage = 'source_read';
        providerDiagnostic('daily_report', 'data', 'started');
        let permitted: Awaited<
          ReturnType<NonNullable<typeof input.data.readDailyReportSnapshot>>
        >;
        try {
          permitted = await input.data.readDailyReportSnapshot!(
            priorWindow.context,
            request.scope,
            request.signal,
          );
        } catch {
          if (request.signal.aborted) return fail('cancelled');
          providerDiagnostic('daily_report', 'data', 'failed');
          return fail(
            request.signal.aborted ? 'cancelled' : 'source_read_failed',
          );
        }
        providerDiagnostic('daily_report', 'data', 'completed');
        input.deadlineContext.stage = 'workflow';
        const allowed = new Set(
          permitted.sourceSnapshot.records.map(row =>
            stableJson([row.source, row.recordId, row.revision]),
          ),
        );
        if (
          existing.context.sourceSnapshot.records.some(
            row =>
              !allowed.has(
                stableJson([row.source, row.recordId, row.revision]),
              ),
          )
        )
          return fail('source_unavailable');

        input.deadlineContext.stage = 'report_read';
        providerDiagnostic('daily_report', 'persistence', 'started');
        let current: Awaited<ReturnType<typeof input.storage.lookup>>;
        try {
          current = await input.storage.lookup(calendar.context.identity);
        } catch {
          if (request.signal.aborted) return fail('cancelled');
          providerDiagnostic('daily_report', 'persistence', 'failed');
          return fail('report_read_failed');
        }
        if (request.signal.aborted) return fail('cancelled');
        if (current.status === 'error') {
          providerDiagnostic('daily_report', 'persistence', 'failed');
          return fail('report_read_failed');
        }
        providerDiagnostic('daily_report', 'persistence', 'completed');
        input.deadlineContext.stage = 'workflow';
        if (
          current.status !== 'saved' ||
          current.runId !== existing.runId ||
          current.revision !== existing.revision
        )
          return fail('source_stale');
      }
      if (request.signal.aborted) return fail('cancelled');
      providerDiagnostic('daily_report', 'workflow', 'result');
      return { ...existing, status: 'reused' as const };
    }
    if (existing.status === 'stale') return fail('source_stale');
    if (existing.status !== 'missing') return fail('source_unavailable');
  }

  input.deadlineContext.stage = 'workflow';
  return generateDailyReport(input, request, calendar);
}
