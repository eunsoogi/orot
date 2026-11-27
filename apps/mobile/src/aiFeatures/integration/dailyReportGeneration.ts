import { createDailyReportDispatchAuthority } from './dailyReportDispatchAuthority';
import { prepareReportCalendar } from './dailyReportSystemCalendar';
import { selectDailyReportProvider } from './dailyReportProviderSelection';
import { generateDailyReportWithCalendar } from './dailyReportGenerationRun';
import type {
  DailyReportRunInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';
import type { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
type ReadyCalendar = Extract<
  ReturnType<typeof createDailyReportCalendarWindow>,
  { status: 'ready' }
>;

/** System calendars are a separate ephemeral input; an explicit local source scope never widens. */
export async function generateDailyReport(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
  calendar: ReadyCalendar,
) {
  const dispatchAuthority = createDailyReportDispatchAuthority();
  let external: Awaited<ReturnType<typeof prepareReportCalendar>> | undefined;
  // The optional local calendar read does not authorize provider selection.
  // Keep all source processing and model dispatch behind both results.
  const capture =
    request.scope.sourceIds || request.signal.aborted
      ? undefined
      : input.captureSelectionCurrent?.();
  const earlySelection = capture?.()
    ? selectDailyReportProvider(input, request, capture)
    : undefined;
  const selection = async () => {
    if (!earlySelection || !capture?.())
      return selectDailyReportProvider(input, request);
    const candidate = await earlySelection;
    // A settings change during the calendar read invalidates this result.
    // Use the original late resolver then; never reuse stale model credentials.
    return capture() ? candidate : selectDailyReportProvider(input, request);
  };
  try {
    if (!request.scope.sourceIds && !request.signal.aborted) {
      try {
        external = await prepareReportCalendar(
          calendar.context,
          input.calendarReader,
          request.signal,
        );
      } catch {
        /* Missing permission or incomplete native coverage is not proof of no schedules. */
      }
    }
    return await generateDailyReportWithCalendar(
      { ...input, dispatchAuthority },
      request,
      calendar,
      external,
      selection,
    );
  } finally {
    dispatchAuthority.dispose();
    external?.snapshot.dispose();
  }
}
