import { createDailyReportIdentity } from '@orot/domain';
import { currentDailyReportContextRequest } from '../../healthEvidence/healthContext/dailyReportWindow';

/** Displays an exact saved day; only the explicit action may invoke generation. */
export function todayIdentity() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const request = currentDailyReportContextRequest(
    new Date().toISOString(),
    zone,
  );
  return request.status === 'ready'
    ? createDailyReportIdentity(
        request.request.localDate,
        request.request.timeZone,
      )
    : null;
}
