import { localQueryTimestampKey } from '@orot/storage';
import type { ChartPoint } from '../ui/charts/types';

/** Retain the Records time axis and all admitted values. Only coincident
 * instants from this existing unit series can produce a nonzero range. */
export function heartRateInstantBuckets(
  measurements: readonly (ChartPoint & { value: number })[],
): ChartPoint[] {
  return combineHeartRateBuckets(measurements, localQueryTimestampKey);
}

/** The bounded library preview displays one truthful range per local recorded day. */
export function heartRateDayBuckets(
  measurements: readonly (ChartPoint & { value: number })[],
): ChartPoint[] {
  return combineHeartRateBuckets(
    measurements,
    value => {
      const date = new Date(value);
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
    },
    true,
  );
}

function combineHeartRateBuckets(
  measurements: readonly (ChartPoint & { value: number })[],
  bucketKey: (value: string) => string,
  day = false,
): ChartPoint[] {
  const buckets = new Map<
    string,
    {
      x: string;
      minimum: number;
      maximum: number;
      mean: number;
      count: number;
      sources: Set<string>;
    }
  >();
  for (const { x, value, source } of measurements) {
    if (!Number.isFinite(Date.parse(x)) || !Number.isFinite(value)) continue;
    const instant = bucketKey(x);
    const bucket = buckets.get(instant);
    if (bucket) {
      bucket.minimum = Math.min(bucket.minimum, value);
      bucket.maximum = Math.max(bucket.maximum, value);
      bucket.count++;
      // Each newly admitted measurement contributes once (never average bucket means).
      bucket.mean += (value - bucket.mean) / bucket.count;
      bucket.sources.add(source);
    } else {
      buckets.set(instant, {
        x: day ? instant : x,
        minimum: value,
        maximum: value,
        mean: value,
        count: 1,
        sources: new Set([source]),
      });
    }
  }
  const ordered = [...buckets.values()];
  if (day) ordered.sort((left, right) => left.x.localeCompare(right.x));
  return ordered.map(bucket => ({
    x: bucket.x,
    value: bucket.mean,
    source: [...bucket.sources].join(' · '),
    range: {
      minimum: bucket.minimum,
      maximum: bucket.maximum,
      samples: bucket.count,
    },
  }));
}
