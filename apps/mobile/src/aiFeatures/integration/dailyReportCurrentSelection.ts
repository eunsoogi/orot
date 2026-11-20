import { providerDiagnostic } from '../../providers/diagnostics';
import { hasSevereReportBloodPressure } from './dailyReportGuidance';
import { prepareDailyReportFacts } from './dailyReportPreparedFacts';
import { selectDailyReportFacts } from './dailyReportModel';
import { stableJson } from './evidenceUtils';
import type { DailyReportSnapshotResult } from '../../healthEvidence/healthContext/dailyReportSnapshotResult';
import type { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import type { prepareReportCalendar } from './dailyReportSystemCalendar';
import type {
  DailyReportRunInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';
import type { SelectedAiResolution } from './provider';

type Calendar = Extract<
  ReturnType<typeof createDailyReportCalendarWindow>,
  { status: 'ready' }
>;
/** A changed pre-dispatch input may be readmitted once, never replaying a remote
 * execution. Each attempt builds a fresh payload and passes exact consent again.
 * Opening delivery is owned outside this loop and is never repeated here. */
export async function selectCurrentDailyReportFacts(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  calendar: Calendar,
  runId: string,
  original: DailyReportSnapshotResult,
  originalFacts: Awaited<ReturnType<typeof prepareDailyReportFacts>>,
  external?: Awaited<ReturnType<typeof prepareReportCalendar>>,
) {
  const identity = stableJson([
    calendar,
    request.timeZone,
    request.scope,
    request.mode,
  ]);
  const currentOwner = () =>
    !request.signal.aborted &&
    identity ===
      stableJson([calendar, request.timeZone, request.scope, request.mode]);
  let snapshot = original;
  let prepared = originalFacts;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!currentOwner())
      return { status: 'failed' as const, code: 'cancelled' as const };
    const refresh = input.prepareSnapshotRefresh?.(
      snapshot,
      calendar.context,
      request.scope,
    );
    let proven = snapshot;
    const selection = await selectDailyReportFacts({
      selected,
      consent: input.consent,
      runId,
      facts: prepared.providerFacts,
      allowAnalysis: !hasSevereReportBloodPressure(snapshot.values),
      reportContext: {
        localDate: calendar.context.identity.localDate,
        timeZone: calendar.context.identity.timeZone,
        generationCutoff: calendar.context.generationCutoff,
        coverage: prepared.sourceSnapshot.coverage,
      },
      includesSystemCalendar: !!external?.facts.length,
      signal: request.signal,
      timeoutMs: input.timeoutMs ?? null,
      deadlineContext: input.deadlineContext,
      revalidate: async signal => {
        input.deadlineContext.stage = 'source_read';
        providerDiagnostic('daily_report', 'data', 'started');
        let current: DailyReportSnapshotResult | null;
        try {
          current = refresh
            ? await refresh(signal)
            : await input.data.readDailyReportSnapshot!(
                calendar.context,
                request.scope,
                signal,
              );
        } catch (error) {
          if (!signal.aborted)
            providerDiagnostic('daily_report', 'data', 'failed');
          throw error;
        }
        providerDiagnostic('daily_report', 'data', 'completed');
        input.deadlineContext.stage = 'workflow';
        if (
          !currentOwner() ||
          !current ||
          signal.aborted ||
          (external && !(await external.snapshot.revalidate()))
        )
          return false;
        if (
          !refresh &&
          stableJson(current.sourceSnapshot) !==
            stableJson(snapshot.sourceSnapshot)
        )
          return false;
        // The calendar bridge can await native work. Its successful result does
        // not keep the request owner alive or make a replaced scope current.
        if (!currentOwner() || signal.aborted) return false;
        proven = current;
        return true;
      },
    });
    if (!currentOwner())
      return { status: 'failed' as const, code: 'cancelled' as const };
    if (selection.status === 'selected')
      return {
        status: 'selected' as const,
        selection,
        snapshot,
        prepared,
        refresh,
        proven,
        currentOwner,
      };
    // This exact result is emitted only before invokeProductionRequest. All
    // provider/stream failures return directly, without an automatic second send.
    if (
      selection.code !== 'source_revision_changed' ||
      attempt !== 0 ||
      !refresh ||
      request.signal.aborted
    )
      return selection;
    const current = await refresh.read(request.signal);
    if (!current)
      return { status: 'failed' as const, code: 'source_read_failed' as const };
    if (!current.values.length)
      return { status: 'failed' as const, code: 'source_unavailable' as const };
    if (external && !(await external.snapshot.revalidate())) return selection;
    snapshot = current;
    prepared = await prepareDailyReportFacts(
      input,
      request,
      calendar,
      snapshot,
      external,
    );
  }
  return {
    status: 'failed' as const,
    code: 'source_revision_changed' as const,
  };
}
