import {
  readHealthObservationMonthQuantity,
  type HealthObservationMonthWindow,
  type HealthObservationQuantityBucket,
} from './healthObservationMonthQuantity';
import {
  readHealthObservationMonthSleep,
  type HealthObservationSleepBucket,
} from './healthObservationMonthSleep';
import type { HealthObservationPageCategory } from './healthObservationPageFilter';
import type { SqlExecutor } from './sql';

export type HealthObservationMonthChart =
  | { readonly kind: 'quantity'; readonly rows: readonly HealthObservationQuantityBucket[] }
  | { readonly kind: 'sleep'; readonly rows: readonly HealthObservationSleepBucket[] };
export type HealthObservationMonthChartLoader = (
  category: Exclude<HealthObservationPageCategory, 'other'>,
  window: HealthObservationMonthWindow,
) => Promise<HealthObservationMonthChart>;

/** Return only measured chart summaries; no detail cursor or record payload. */
export async function readHealthObservationMonthChart(
  database: SqlExecutor,
  category: Parameters<HealthObservationMonthChartLoader>[0],
  window: HealthObservationMonthWindow,
): Promise<HealthObservationMonthChart> {
  return category === 'sleep'
    ? { kind: 'sleep', rows: await readHealthObservationMonthSleep(database, window) }
    : {
        kind: 'quantity',
        rows: await readHealthObservationMonthQuantity(database, category, window),
      };
}
