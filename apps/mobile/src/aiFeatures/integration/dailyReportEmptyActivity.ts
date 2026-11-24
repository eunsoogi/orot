import type { DailyReportSourceCoverage } from '@orot/domain';
import { t } from '../../i18n';

/** Dedicated local findings have their own display; any erroneous/failed
 * activity marker must still be exposed as a coverage issue. */
export function isDailyReportActivityMarker(item: DailyReportSourceCoverage) {
  return (
    (item.source === 'local_workout_records' ||
      item.source === 'local_sleep_records') &&
    item.status === 'empty' &&
    Boolean(item.lastSuccessfulAt) &&
    item.syncStatus !== 'retryable' &&
    item.limitationCodes.length === 0
  );
}

/** Surface checked-empty local records without fabricating a source citation
 * or interpreting a device's silence as inactivity. */
export function dailyReportEmptyActivity(
  coverage: readonly DailyReportSourceCoverage[],
): readonly string[] {
  return coverage.flatMap(item => {
    if (!isDailyReportActivityMarker(item)) return [];
    if (item.source === 'local_workout_records')
      return [t('dailyReport.activity.emptyWorkout')];
    if (item.source === 'local_sleep_records')
      return [t('dailyReport.activity.emptySleep')];
    return [];
  });
}
