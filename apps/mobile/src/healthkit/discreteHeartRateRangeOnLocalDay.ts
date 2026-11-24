import type { HealthObservation } from '@orot/domain';
import { classifyAppleDerivedHeartRate } from '@orot/storage';

/** Extrema do not identify their day outside a fully contained source interval. */
export function discreteHeartRateRangeOnLocalDay(record: HealthObservation) {
  const stats = record.heartRateSampleSummary;
  if (!stats || !record.endedAt || !classifyAppleDerivedHeartRate(record))
    return;
  const start = new Date(record.effectiveAt);
  const end = new Date(record.endedAt);
  const nextLocalMidnight = new Date(start);
  nextLocalMidnight.setHours(24, 0, 0, 0);
  if (!(+end >= +start && +end < +nextLocalMidnight)) return;
  return {
    samples: stats.count,
    minimum: stats.minimum,
    maximum: stats.maximum,
  };
}
