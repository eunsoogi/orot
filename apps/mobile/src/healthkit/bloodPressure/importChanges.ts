import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import { mapBloodPressureCorrelation } from './mapper';
import {
  bloodPressureObservationId,
  type BloodPressureChangePage,
  type BloodPressureRepository,
  type BloodPressureSyncResult,
} from './types';

const components = ['systolic', 'diastolic'] as const;
export const BLOOD_PRESSURE_CHECKPOINT_KEY =
  healthKitSampleChangesCheckpointKey('bloodPressure', 'bloodPressure');

/** Commits one correlation page and its opaque cursor in the same database transaction. */
export async function applyBloodPressureChanges(
  repository: BloodPressureRepository,
  page: BloodPressureChangePage,
  previousCursor: string | null,
  now: () => string,
): Promise<
  Pick<BloodPressureSyncResult, 'upserted' | 'deleted' | 'cursorAdvanced'>
> {
  const ingestedAt = now();
  const correlations = page.addedSamples.map(sample =>
    mapBloodPressureCorrelation(sample, ingestedAt),
  );
  const correlationIds = correlations.map(({ correlationId }) => correlationId);
  const deletedCorrelationIds = page.deletedSampleIds;
  if (
    new Set(correlationIds).size !== correlationIds.length ||
    new Set(deletedCorrelationIds).size !== deletedCorrelationIds.length ||
    deletedCorrelationIds.some(id => id.trim().length === 0) ||
    correlationIds.some(id => deletedCorrelationIds.includes(id))
  ) {
    throw new Error(
      'HealthKit returned conflicting blood-pressure correlation IDs.',
    );
  }

  const nextCursor = page.cursor ?? previousCursor;
  const cursorAdvanced = nextCursor !== null && nextCursor !== previousCursor;
  if (
    correlations.length === 0 &&
    deletedCorrelationIds.length === 0 &&
    !cursorAdvanced
  ) {
    return { upserted: 0, deleted: 0, cursorAdvanced: false };
  }

  let upserted = 0;
  let deleted = 0;
  await repository.transaction(async writer => {
    for (const correlation of correlations) {
      const expectedIds = new Set(correlation.observations.map(({ id }) => id));
      for (const observation of correlation.observations) {
        const existing = await writer.get('health_observation', observation.id);
        const next = preserveIngestedAt(existing, observation);
        if (next !== existing) {
          await writer.put('health_observation', next);
          upserted += 1;
        }
      }
      // A changed correlation with a missing component removes only that stale component row.
      for (const component of components) {
        const id = bloodPressureObservationId(
          correlation.correlationId,
          component,
        );
        if (
          !expectedIds.has(id) &&
          (await writer.delete('health_observation', id))
        ) {
          deleted += 1;
        }
      }
    }

    for (const correlationId of deletedCorrelationIds) {
      for (const component of components) {
        if (
          await writer.delete(
            'health_observation',
            bloodPressureObservationId(correlationId, component),
          )
        ) {
          deleted += 1;
        }
      }
    }

    if (cursorAdvanced && nextCursor) {
      await writer.putSyncCheckpoint({
        key: BLOOD_PRESSURE_CHECKPOINT_KEY,
        value: nextCursor,
        updatedAt: ingestedAt,
      });
    }
  });

  return { upserted, deleted, cursorAdvanced };
}

/** Replays retain their first ingestion timestamp while changed source values are refreshed. */
function preserveIngestedAt<T extends { readonly ingestedAt: string }>(
  existing: T | null,
  candidate: T,
): T {
  if (!existing) return candidate;
  const preserved = { ...candidate, ingestedAt: existing.ingestedAt };
  return JSON.stringify(preserved) === JSON.stringify(existing)
    ? existing
    : preserved;
}
