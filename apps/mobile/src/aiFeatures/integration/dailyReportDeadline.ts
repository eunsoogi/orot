import { reportProcessingDeadline } from './dailyReportAuthorizationWait';
import { providerDiagnostic } from '../../providers/diagnostics';
import type {
  DailyReportDeadlineContext,
  DailyReportDeadlineStage,
  DailyReportFailureCode,
} from './dailyReportTypes';

type DeadlineFailure = { status: 'failed'; code: DailyReportFailureCode };

/** Creates isolated deadline state for one report request and its nested service calls. */
export function createDailyReportDeadlineContext(
  stage: DailyReportDeadlineStage = 'workflow',
): DailyReportDeadlineContext {
  return { stage, timedOut: false };
}

/** Maps a deadline to the active boundary so the user gets its matching recovery action. */
export function dailyReportDeadlineFailure(
  context: DailyReportDeadlineContext,
): DeadlineFailure {
  context.timedOut = true;
  switch (context.stage) {
    case 'report_read':
      providerDiagnostic('daily_report', 'persistence', 'failed');
      return { status: 'failed', code: 'report_read_failed' };
    case 'source_read':
      providerDiagnostic('daily_report', 'data', 'failed');
      return { status: 'failed', code: 'source_read_failed' };
    case 'provider_selection':
      providerDiagnostic('daily_report', 'selection', 'unavailable');
      return { status: 'failed', code: 'timeout' };
    case 'consent':
      providerDiagnostic('daily_report', 'workflow', 'consent_required');
      return { status: 'failed', code: 'consent_required' };
    case 'provider':
      providerDiagnostic('daily_report', 'provider_error', 'failed');
      return { status: 'failed', code: 'timeout' };
    case 'validation':
      providerDiagnostic('daily_report', 'validation', 'invalid_output');
      return { status: 'failed', code: 'malformed_output' };
    case 'save':
      providerDiagnostic('daily_report', 'persistence', 'failed');
      return { status: 'failed', code: 'persistence_failed' };
    case 'workflow':
      providerDiagnostic('daily_report', 'workflow', 'other');
      return { status: 'failed', code: 'error' };
  }
}

/** Propagate cancellation through preparation and inference; finite deadlines are opt-in.
 * Even without a timer, a late operation cannot publish after its owner aborts. */
export async function boundedDailyReport<T>(
  signal: AbortSignal,
  timeoutMs: number | null,
  work: (signal: AbortSignal) => Promise<T>,
  onTimeout?: () => DeadlineFailure,
  context?: DailyReportDeadlineContext,
): Promise<T | DeadlineFailure | { status: 'failed'; code: 'cancelled' }> {
  if (signal.aborted) return { status: 'failed', code: 'cancelled' };
  const controller = new AbortController();
  let timedOut = false;
  let timeoutFailure: DeadlineFailure | undefined;
  const classifyTimeout =
    onTimeout ??
    (() => ({ status: 'failed' as const, code: 'timeout' as const }));
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => {
    stop = resolve;
  });
  const abort = () => {
    controller.abort();
    stop();
  };
  signal.addEventListener('abort', abort, { once: true });
  const timer = reportProcessingDeadline(
    context,
    () => {
      timedOut = true;
      timeoutFailure = classifyTimeout();
      abort();
    },
    timeoutMs,
  );
  try {
    const result = await Promise.race([
      work(controller.signal),
      stopped.then(
        () =>
          timeoutFailure ?? {
            status: 'failed' as const,
            code: 'cancelled' as const,
          },
      ),
    ]);
    return timedOut
      ? timeoutFailure!
      : signal.aborted
        ? { status: 'failed', code: 'cancelled' }
        : result;
  } catch {
    if (timedOut) return timeoutFailure!;
    if (signal.aborted) return { status: 'failed', code: 'cancelled' };
    // Do not label an unclassified exception as missing health data.
    providerDiagnostic('daily_report', 'workflow', 'other');
    return {
      status: 'failed',
      code: 'error',
    };
  } finally {
    timer.dispose();
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}
