import { prepareReportCalendar } from './dailyReportSystemCalendar';
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
  let external: Awaited<ReturnType<typeof prepareReportCalendar>> | undefined;
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
      input,
      request,
      calendar,
      external,
    );
  } finally {
    external?.snapshot.dispose();
  }
}
