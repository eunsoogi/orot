import { mapBloodPressureCorrelation } from './mapper';
import type { BloodPressureChangePage, BloodPressureWriter } from './types';

/** Applies one completed incremental page; only explicit deletion IDs remove records. */
export async function applyBloodPressureChanges(
  page: BloodPressureChangePage,
  writer: BloodPressureWriter,
): Promise<{ readonly upserted: number; readonly deleted: number }> {
  const observations = page.insertedOrUpdated.map(mapBloodPressureCorrelation);
  const observationIds = new Set(observations.map(({ id }) => id));
  if (observationIds.size !== observations.length) {
    throw new Error(
      'A blood-pressure change page contains duplicate correlation IDs.',
    );
  }

  const deletedIds = page.deletedCorrelationIds.map(id => {
    if (id.trim().length === 0)
      throw new Error('A deleted correlation id is required.');
    return id;
  });
  const uniqueDeletedIds = [...new Set(deletedIds)];

  await writer.transaction(async transaction => {
    for (const observation of observations)
      await transaction.upsert(observation);
    // If a page reports both states for one UUID, its explicit deletion is authoritative.
    for (const correlationId of uniqueDeletedIds)
      await transaction.delete(correlationId);
  });

  // The provider cursor must advance only after this storage transaction commits.
  return { upserted: observations.length, deleted: uniqueDeletedIds.length };
}
