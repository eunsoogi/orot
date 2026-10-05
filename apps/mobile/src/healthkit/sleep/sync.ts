import { SleepImportError } from './errors';
import { mapHealthKitSleepSample } from './mapper';
import type { SleepImportState, SleepSyncChanges } from './types';

export function applySleepChanges(
  current: SleepImportState,
  changes: SleepSyncChanges,
): SleepImportState {
  // Validate the whole delta before returning its new anchor and sample set.
  if (!changes.complete) {
    throw new SleepImportError(
      'INCOMPLETE_SLEEP_SYNC',
      'An incomplete HealthKit delta cannot advance the sleep anchor.',
    );
  }
  if (changes.nextAnchor !== null && !nonEmptyText(changes.nextAnchor)) {
    throw new SleepImportError(
      'INVALID_SLEEP_ANCHOR',
      'A completed HealthKit delta must include a valid next anchor.',
    );
  }
  if (
    !Array.isArray(changes.addedOrUpdated) ||
    !Array.isArray(changes.deletedSampleIds)
  ) {
    throw new SleepImportError(
      'INVALID_SLEEP_SYNC_DELTA',
      'A HealthKit sleep delta must include sample and deletion arrays.',
    );
  }

  const addedById = new Map<
    string,
    ReturnType<typeof mapHealthKitSleepSample>
  >();
  for (const rawSample of changes.addedOrUpdated) {
    const sample = mapHealthKitSleepSample(rawSample);
    if (addedById.has(sample.id)) {
      throw new SleepImportError(
        'DUPLICATE_SLEEP_SAMPLE_ID',
        'A HealthKit delta cannot contain the same sample ID more than once.',
      );
    }
    addedById.set(sample.id, sample);
  }

  const deletedIds = new Set<string>();
  for (const id of changes.deletedSampleIds) {
    if (!nonEmptyText(id)) {
      throw new SleepImportError(
        'INVALID_SLEEP_DELETION',
        'A deleted HealthKit sample must include its stable ID.',
      );
    }
    deletedIds.add(id);
  }
  for (const id of addedById.keys()) {
    if (deletedIds.has(id)) {
      throw new SleepImportError(
        'CONFLICTING_SLEEP_SYNC_DELTA',
        'A HealthKit sample cannot be added and deleted in the same delta.',
      );
    }
  }

  const byId = new Map(current.samples.map(sample => [sample.id, sample]));
  for (const id of deletedIds) byId.delete(id);
  for (const [id, sample] of addedById) byId.set(id, sample);

  return {
    samples: [...byId.values()].sort((left, right) =>
      compareText(left.id, right.id),
    ),
    anchor: changes.nextAnchor,
  };
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
