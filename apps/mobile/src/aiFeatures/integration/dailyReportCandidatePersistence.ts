import type { DailyReportSave } from '../../storage/dailyReportStorageTypes';
import type { DailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import type {
  DailyReportRunInput,
  DailyReportFailureCode,
} from './dailyReportTypes';
import { providerDiagnostic } from '../../providers/diagnostics';

/** Preserve the ordinary final save fences. Only a persistence error can stage an
 * already validated result; stale/deleted/cancelled outputs are never recoverable. */
export async function persistDailyReportCandidate(
  input: DailyReportRunInput,
  candidate: DailyReportSave,
  calendar: DailyReportCalendarWindow,
  signal: AbortSignal,
): Promise<
  | { status: 'saved' | 'reused' }
  | { status: 'failed'; code: DailyReportFailureCode }
> {
  let saved: Awaited<ReturnType<typeof input.storage.save>>;
  try {
    saved = await input.storage.save(candidate, signal);
  } catch {
    saved = signal.aborted ? { status: 'cancelled' } : { status: 'error' };
  }
  input.deadlineContext.stage = 'workflow';
  if (saved.status === 'saved' || saved.status === 'reused')
    return { status: saved.status };
  if (!input.deadlineContext.timedOut)
    providerDiagnostic(
      'daily_report',
      'persistence',
      signal.aborted || saved.status === 'cancelled' ? 'cancelled' : 'failed',
    );
  if (saved.status === 'error' && !signal.aborted) {
    // Metadata is discovered later by an explicit local-save UI. Failure here
    // never claims recoverability or hides the original persistence error.
    try {
      await input.stageRecovery?.(candidate, calendar, candidate.runId, signal);
    } catch {
      /* Original failure remains. */
    }
  }
  const code: DailyReportFailureCode =
    signal.aborted || saved.status === 'cancelled'
      ? 'cancelled'
      : saved.status === 'stale'
        ? 'source_revision_changed'
        : saved.status === 'deleted'
          ? 'source_unavailable'
          : 'persistence_failed';
  return { status: 'failed' as const, code };
}
