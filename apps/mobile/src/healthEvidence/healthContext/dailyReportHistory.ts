import { readDailyReportBaseline } from './dailyReportBaseline';
import { readDailyReportBehaviorHistory } from './dailyReportBehaviorHistory';

/** Share the remaining snapshot byte budget; each history preserves separate roles and limitations. */
export async function readDailyReportHistory(
  ...args: Parameters<typeof readDailyReportBaseline>
) {
  // Reserve half for behavior before baseline reads. Unused baseline capacity
  // returns to behavior, but neither abundant measurements nor doses may starve workouts.
  const baseline = await readDailyReportBaseline(
    args[0],
    args[1],
    args[2],
    args[3],
    Math.floor(args[4] / 2),
    args[5],
  );
  const behavior = await readDailyReportBehaviorHistory(
    args[0],
    args[1],
    args[2],
    args[3],
    args[4] - baseline.bytes,
    args[5],
  );
  return {
    baselineValues: baseline.values,
    behaviorValues: behavior.values,
    records: [...baseline.records, ...behavior.records],
    lineage: [...baseline.lineage, ...behavior.lineage],
    coverage: [
      {
        source: 'personal_baseline',
        status: 'partial' as const,
        limitationCodes: [
          'observed_days_not_complete_history',
          ...(baseline.partial ? ['snapshot_incomplete'] : []),
        ],
      },
      {
        source: 'behavior_history',
        status: 'partial' as const,
        limitationCodes: [
          'recorded_behavior_not_complete_history',
          ...(behavior.partial ? ['snapshot_incomplete'] : []),
        ],
      },
    ],
  };
}
