import type { HealthKitNativeModule } from '../types';
import { commitHealthKitChanges } from '../commitHealthKitChanges';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from './mapper';
import type { SyncCommonObservationChangesOptions } from './syncOptions';

/** Enrich only retained matching Apple-derived rows; the anchored cursor still
 * owns adds and deletes. Empty/denied/truncated snapshots never erase records. */
export async function refreshRecentDiscreteHeartRate(
  options: SyncCommonObservationChangesOptions,
  query: HealthKitNativeModule['querySamples'],
) {
  const { feature, repository } = options;
  if (feature !== 'restingHeartRate' && feature !== 'walkingHeartRateAverage')
    return 0;
  const now = options.now();
  const at = Date.parse(now);
  if (!Number.isFinite(at)) return 0;
  const endDate = new Date(at);
  const startDate = new Date(at);
  // A bounded recent month plus overlap; view bucketing still uses actual local dates.
  startDate.setDate(startDate.getDate() - 31);
  startDate.setHours(0, 0, 0, 0);
  let result;
  try {
    result = await query({
      feature,
      sampleKind: feature,
      limit: 500,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
  } catch {
    return 0; // The authoritative anchored import already completed.
  }
  if (result.status !== 'completed' || result.availability !== 'available')
    return 0;
  const ids = new Set<string>();
  const rows = result.samples.flatMap(sample => {
    if (ids.has(sample.id)) return [];
    ids.add(sample.id);
    const mapped = mapCommonObservationSample(feature, sample);
    if (
      mapped.status !== 'mapped' ||
      !mapped.observation.heartRateSampleSummary
    )
      return [];
    if (
      Date.parse(sample.startDate) < +startDate ||
      Date.parse(sample.endDate) > at
    )
      return [];
    return [toCommonObservationRecord(mapped.observation, now)];
  });
  // A malformed list can carry conflicting snapshots of the same UUID.
  if (!rows.length || ids.size !== result.samples.length) return 0;
  return commitHealthKitChanges(repository, async writer => {
    let enriched = 0;
    for (const row of rows) {
      const existing = await writer.get('health_observation', row.id);
      if (!existing || existing.heartRateSampleSummary) continue;
      const { heartRateSampleSummary, ...scalar } = row;
      if (
        JSON.stringify({ ...scalar, ingestedAt: existing.ingestedAt }) !==
        JSON.stringify(existing)
      )
        continue;
      await writer.put('health_observation', {
        ...existing,
        heartRateSampleSummary,
      });
      enriched++;
    }
    return enriched;
  });
}
