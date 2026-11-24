import type { HealthKitSampleSnapshot } from '../types';

/** Missing, malformed or unexpected native statistics never turn into fabricated
 * extrema. Preserve the existing scalar reading as the backwards-compatible value. */
export function discreteDerivedHeartRateSummary(
  feature: string,
  sample: HealthKitSampleSnapshot,
) {
  if (feature !== 'restingHeartRate' && feature !== 'walkingHeartRateAverage')
    return;
  const summary = sample.heartRateSampleSummary;
  if (!summary || typeof summary !== 'object') return;
  const { count, minimum, maximum, mean } = summary;
  if (
    !Number.isSafeInteger(count) ||
    count < 2 ||
    count > 1_000_000 ||
    ![minimum, maximum, mean].every(
      v => typeof v === 'number' && Number.isFinite(v) && v > 0,
    ) ||
    minimum > mean ||
    mean > maximum ||
    mean !== sample.value
  )
    return;
  return { count, minimum, maximum, mean };
}
