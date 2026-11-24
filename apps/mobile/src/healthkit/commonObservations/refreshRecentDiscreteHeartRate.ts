import type { HealthKitNativeModule } from '../types';
import { healthKitAutoSyncCheckpointKey } from '../autoSyncCheckpoint';
import { subscribeLocalDataClear } from '../../storage/localDataClearEvents';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from './mapper';
import type { SyncCommonObservationChangesOptions } from './syncOptions';

const derivedInspectionLimit = 500;
const derivedInspectionRetryMs = 24 * 60 * 60 * 1000;

/** Enrich only retained matching Apple-derived rows; the anchored cursor still
 * owns adds and deletes. Empty/denied/truncated snapshots never erase records. */
export async function refreshRecentDiscreteHeartRate(
  options: SyncCommonObservationChangesOptions,
  query: HealthKitNativeModule['querySamples'],
) {
  const { feature, repository } = options;
  if (feature !== 'restingHeartRate' && feature !== 'walkingHeartRateAverage')
    return 0;
  const requestedAt = options.derivedAutoSyncRequest;
  const automaticKey =
    requestedAt === undefined
      ? undefined
      : `healthkit:derived-discrete-inspection:v1:${feature}`;
  const currentRequest = async () => {
    if (requestedAt === undefined) return true;
    const choice = await repository.getSyncCheckpoint(
      healthKitAutoSyncCheckpointKey(feature),
    );
    return choice?.value === 'requested' && choice.updatedAt === requestedAt;
  };
  let retired = false;
  const release = subscribeLocalDataClear(() => {
    retired = true;
  });
  try {
    if (automaticKey) {
      const previous = await repository.getSyncCheckpoint(automaticKey);
      const last = Date.parse(previous?.updatedAt ?? '');
      const elapsed = Date.parse(options.now()) - last;
      // Do not repeatedly rescan the same incomplete snapshot on rapid launches.
      if (
        last >= Date.parse(requestedAt!) &&
        (previous?.value === 'inspected' || previous?.value === 'attempted') &&
        elapsed >= 0 &&
        elapsed < derivedInspectionRetryMs
      )
        return 0;
    }
    if (!(await currentRequest()) || retired) return 0;
    return await inspectRecentDerivedSamples(
      options,
      query,
      automaticKey,
      async () => !retired && (await currentRequest()),
      () => !retired,
    );
  } finally {
    release();
  }
}

async function inspectRecentDerivedSamples(
  options: SyncCommonObservationChangesOptions,
  query: HealthKitNativeModule['querySamples'],
  automaticKey: string | undefined,
  mayPersist: () => Promise<boolean>,
  isCurrent: () => boolean,
) {
  const { feature, repository } = options;
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
      limit: derivedInspectionLimit,
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
  if (
    ids.size !== result.samples.length ||
    (!automaticKey && !rows.length) ||
    !(await mayPersist())
  )
    return 0;
  // Enrichment isn't a deletion; do not invalidate retained sources as if removed.
  return repository.transaction(async (writer, sql) => {
    if (!isCurrent()) return 0;
    if (automaticKey) {
      // The prior read cannot authorize a queued writer after opt-out or wipe.
      if (!sql) return 0;
      const current = await sql.execute(
        'SELECT value, updated_at FROM healthkit_sync_checkpoints WHERE checkpoint_key = ?',
        [healthKitAutoSyncCheckpointKey(feature)],
      );
      const choice = current.rows[0];
      if (
        !isCurrent() ||
        choice?.value !== 'requested' ||
        choice.updated_at !== options.derivedAutoSyncRequest
      )
        return 0;
    }
    let enriched = 0;
    for (const row of rows) {
      const existing = await writer.get('health_observation', row.id);
      if (!existing) continue;
      const { heartRateSampleSummary: previousSummary, ...previousScalar } =
        existing;
      const { heartRateSampleSummary, ...scalar } = row;
      if (
        JSON.stringify({ ...scalar, ingestedAt: existing.ingestedAt }) !==
        JSON.stringify(previousScalar)
      )
        continue;
      // Keep existing stats unchanged; contradictory native subsets don't
      // grant authority to replace another exact scoped observation.
      if (previousSummary) continue;
      await writer.put('health_observation', {
        ...existing,
        heartRateSampleSummary,
      });
      enriched++;
    }
    if (automaticKey && isCurrent()) {
      // Native results cannot prove the whole retained cohort was inspected,
      // even when one exact observation matched. This is only a retry delay.
      await writer.putSyncCheckpoint({
        key: automaticKey,
        value: 'attempted',
        updatedAt: now,
      });
    }
    return enriched;
  });
}
