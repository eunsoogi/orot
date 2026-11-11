import type { useDailyReportRoute } from './useDailyReportRoute';

/** Keep unavailable source states distinct from an ordinary missing report. */
export function dailyReportLookupNotice(
  lookup: ReturnType<typeof useDailyReportRoute>['lookup'],
  revisionChanged: boolean,
  isToday: boolean,
) {
  return revisionChanged
    ? 'dailyReport.stale'
    : lookup?.status === 'stale'
      ? 'sourceStatus' in lookup && lookup.sourceStatus === 'deleted'
        ? 'dailyReport.deletedSource'
        : 'dailyReport.stale'
      : lookup?.status === 'deleted'
        ? 'dailyReport.deleted'
        : !isToday && lookup?.status === 'missing'
          ? 'dailyReport.missingOld'
          : null;
}
