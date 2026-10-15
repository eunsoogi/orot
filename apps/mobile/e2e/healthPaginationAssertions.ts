import type { HealthObservation } from '@orot/domain';
import type { HealthObservationCursor, RecordRepository } from '@orot/storage';

const fixtureTime = Date.parse('2026-10-01T12:00:00.000Z');
const recordCount = 1503;
const fixtureId = (index: number) =>
  `pagination-health-${String(index).padStart(4, '0')}`;

/** Timestamp ties cross page boundaries; expected order does not depend on the query result. */
function observationAt(index: number): HealthObservation {
  const effectiveAt = new Date(
    fixtureTime - Math.floor(index / 3) * 60 * 60 * 1000,
  ).toISOString();
  return {
    id: fixtureId(index),
    effectiveAt,
    recordedAt: effectiveAt,
    ingestedAt: new Date(fixtureTime).toISOString(),
    provenance: {
      origin: 'imported',
      sourceRecordIds: [],
      source: { system: 'healthkit', sourceIdentifier: 'synthetic-pagination' },
    },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept: 'heart_rate',
    value: { kind: 'quantity', amount: 60 + (index % 30), unit: 'count/min' },
  };
}

/** Runs against a real repository; only input records are synthetic, never the SQL implementation. */
export async function assertHealthPagination(repository: RecordRepository) {
  await repository.transaction(async writer => {
    for (let index = 0; index < recordCount; index += 1)
      await writer.put('health_observation', observationAt(index));
  });
  const seen: string[] = [];
  let cursor: HealthObservationCursor | null = null;
  let firstCursor: HealthObservationCursor | null = null;
  let pages = 0;
  do {
    // Omitting limit intentionally verifies the shipping default of 50, independently of the UI adapter.
    const page = await repository.listHealthObservationPage(cursor);
    const expectedSize = Math.min(50, recordCount - seen.length);
    if (page.records.length !== expectedSize || pages >= 31)
      throw new Error(
        'Health pagination changed its default size or did not terminate',
      );
    for (const record of page.records) {
      if (record.id !== fixtureId(seen.length))
        throw new Error(
          'Health pagination omitted, duplicated or reordered a record',
        );
      if (
        seen.length === 55 &&
        (record.value.kind !== 'quantity' ||
          record.value.amount !== 85 ||
          record.value.unit !== 'count/min')
      )
        throw new Error(
          'Health pagination changed the original second-page value',
        );
      seen.push(record.id);
    }
    cursor = page.nextCursor;
    if (pages === 0) firstCursor = cursor;
    pages += 1;
  } while (cursor);
  if (seen.length !== recordCount || pages !== 31 || !firstCursor)
    throw new Error(
      'Health pagination ended before the complete library was read',
    );

  // A cursor is a position, not a foreign key: deletion and a newer arrival must not shift the next page.
  await repository.delete('health_observation', firstCursor.id);
  await repository.put('health_observation', {
    ...observationAt(0),
    id: 'pagination-newer-arrival',
    effectiveAt: '2026-10-02T12:00:00.000Z',
  });
  const next = await repository.listHealthObservationPage(firstCursor);
  if (
    next.records.length !== 50 ||
    next.records.some((record, index) => record.id !== fixtureId(50 + index))
  )
    throw new Error('A deleted cursor or newer arrival changed the next page');
  return {
    recordCount: seen.length,
    pageCount: pages,
    defaultPageSize: 50,
    secondPageValue: '85 count/min',
    tiedTimestamps: true,
    deletedCursorAndNewerArrival: true,
  };
}
