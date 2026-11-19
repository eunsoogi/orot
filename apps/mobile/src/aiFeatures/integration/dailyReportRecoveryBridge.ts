import type { SqlDatabase } from '@orot/storage';
import type { DailyReportSave } from '../../storage/dailyReportStorageTypes';
import type { DailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { readDailyReportRecoveryOwner } from '../../agent/execution/dailyReportRecoveryOwner';
import { createDailyReportLocalRecovery } from '../../storage/dailyReportLocalRecovery';
import { createDailyReportRecoveryRequestScope } from './dailyReportRecoveryRequestScope';
import type { ReportCalendarReader } from './dailyReportSystemCalendar';

/** Called only after final candidate validation and an actual local save error.
 * The calendar and run identity come from the running producer, not pending bytes.
 * Grant lookup failure is not recovery; no provider/authorize/retry occurs here. */
export function createDailyReportRecoveryBridge(
  database: SqlDatabase,
  calendarReader?: ReportCalendarReader,
) {
  return async (
    candidate: DailyReportSave,
    calendar: DailyReportCalendarWindow,
    runId: string,
    signal: AbortSignal,
  ) => {
    const scope = createDailyReportRecoveryRequestScope({
      activeRequest: () => ({
        runId,
        phase: 'running',
        request: {
          localDate: calendar.identity.localDate,
          timeZone: calendar.identity.timeZone,
          requestedAt: calendar.generationCutoff,
        },
      }),
      currentIdentity: () => calendar.identity,
      // The running request owns this frozen window. Its coordinator aborts
      // this signal on cancellation or release of the last route owner.
      subscribeChanges: () => () => {},
      signal,
    });
    const owner = await readDailyReportRecoveryOwner(candidate, signal, scope);
    if (!owner) return false;
    try {
      return (
        (
          await createDailyReportLocalRecovery(database, calendarReader).stage(
            candidate,
            owner,
            signal,
          )
        ).status === 'staged'
      );
    } catch {
      return false;
    } finally {
      owner.dispose();
    }
  };
}
