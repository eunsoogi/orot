import type { DailyReportContext } from '@orot/domain';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { validateDailyReportCompletion } from '../../storage/dailyReportValidation';
import { fingerprint } from './evidenceUtils';
import type { SelectedAiResolution } from './provider';
import type { DailyReportSave } from '../../storage/dailyReportStorageTypes';
import type { DailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import type {
  DailyReportRunInput,
  DailyReportFailureCode,
} from './dailyReportTypes';
import { providerDiagnostic } from '../../providers/diagnostics';

type ContextCandidate = DailyReportSave & { context: DailyReportContext };
type SaveProof = NonNullable<
  ReturnType<NonNullable<DailyReportRunInput['prepareSnapshotRefresh']>>
>;
type LocalReproof = {
  refresh?: SaveProof;
  current(): boolean;
  calendarCurrent?: (signal: AbortSignal) => Promise<boolean>;
  selected: Extract<SelectedAiResolution, { status: 'ready' }>;
};

/** Rebase only the proof token of an admitted on-device candidate, never its result or lineage. */
async function refreshedCandidate(
  candidate: ContextCandidate,
  calendar: DailyReportCalendarWindow,
  signal: AbortSignal,
  proof: LocalReproof,
): Promise<ContextCandidate | null> {
  try {
    if (!proof.refresh || signal.aborted || !proof.current()) return null;
    if (proof.calendarCurrent && !(await proof.calendarCurrent(signal)))
      return null;
    if (signal.aborted || !proof.current()) return null;
    const latest = await proof.refresh(signal);
    if (!latest || signal.aborted || !proof.current()) return null;
    if (proof.calendarCurrent && !(await proof.calendarCurrent(signal)))
      return null;
    if (signal.aborted || !proof.current()) return null;
    const original = candidate.context.sourceSnapshot;
    const token = latest.sourceSnapshot;
    if (
      token.deletionGeneration !== original.deletionGeneration ||
      token.mutationGeneration <= original.mutationGeneration
    )
      return null;
    const systemCalendar = candidate.context.systemCalendar;
    const context = createDailyReportContext(
      calendar,
      {
        ...original,
        mutationGeneration: token.mutationGeneration,
        revision: systemCalendar
          ? fingerprint({ local: token.revision, systemCalendar })
          : token.revision,
      },
      candidate.context.provider,
      systemCalendar,
    );
    return validateDailyReportCompletion(context, candidate.result)
      ? { ...candidate, context }
      : null;
  } catch {
    return null;
  }
}

/** Preserve the ordinary final save fences. Only a persistence error can stage an
 * already validated result; stale/deleted/cancelled outputs are never recoverable.
 * A stale save happens after model dispatch and requires a new explicit request. */
export async function persistDailyReportCandidate(
  input: DailyReportRunInput,
  candidate: ContextCandidate,
  calendar: DailyReportCalendarWindow,
  signal: AbortSignal,
  proof: LocalReproof,
): Promise<
  | {
      status: 'saved' | 'reused';
      context: DailyReportContext;
      liveAfterReproof?: () => boolean;
    }
  | { status: 'failed'; code: DailyReportFailureCode }
> {
  const save = async (
    value: ContextCandidate,
    saveSignal: AbortSignal,
    initialProof = false,
  ): ReturnType<typeof input.storage.save> => {
    try {
      return initialProof
        ? await input.storage.save(value, saveSignal, { mutationReproof: true })
        : await input.storage.save(value, saveSignal);
    } catch {
      return saveSignal.aborted ? { status: 'cancelled' } : { status: 'error' };
    }
  };
  const owner =
    !proof.selected.remoteProcessing &&
    proof.selected.option.privacyBoundary === 'on-device'
      ? proof.selected.onDeviceSelectionWitness
      : undefined;
  let saved = await save(
    candidate,
    signal,
    !!proof.refresh && owner?.isCurrent() === true,
  );
  let reproved = false;
  if (saved.status === 'stale' && saved.mutationOnly && owner) {
    const retry = new AbortController();
    const abort = () => retry.abort();
    const checkSelection = () => {
      if (!owner.isCurrent()) abort();
    };
    signal.addEventListener('abort', abort, { once: true });
    let release = () => {};
    try {
      release = owner.subscribe(checkSelection);
      if (signal.aborted) abort();
      checkSelection();
      const refreshed = await refreshedCandidate(
        candidate,
        calendar,
        retry.signal,
        proof,
      );
      if (refreshed && !retry.signal.aborted && proof.current()) {
        candidate = refreshed;
        reproved = true;
        // The normal transaction still verifies native Calendar, sources, deletion and the active head.
        saved = await save(candidate, retry.signal);
      }
    } finally {
      release();
      signal.removeEventListener('abort', abort);
      abort();
    }
  }
  input.deadlineContext.stage = 'workflow';
  if (saved.status === 'saved' || saved.status === 'reused')
    return {
      status: saved.status,
      context: candidate.context,
      ...(reproved && owner
        ? {
            liveAfterReproof: () =>
              !signal.aborted && owner.isCurrent() && proof.current(),
          }
        : {}),
    };
  if (!input.deadlineContext.timedOut)
    providerDiagnostic(
      'daily_report',
      'persistence',
      signal.aborted || saved.status === 'cancelled' ? 'cancelled' : 'failed',
    );
  if (saved.status === 'error' && !signal.aborted && !reproved) {
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
        ? 'source_unconfirmed_after_dispatch'
        : saved.status === 'deleted'
          ? 'source_unavailable'
          : 'persistence_failed';
  return { status: 'failed' as const, code };
}
