import type { HealthObservationPageFilter } from '@orot/storage';

/** Reads the records the app already saved; it never starts a HealthKit import. */
export async function listLocalHealthObservations() {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  const repository = await openLocalStorage();
  const observations = await repository.list('health_observation');
  return [...observations].sort((left, right) => {
    const byTime = right.effectiveAt.localeCompare(left.effectiveAt);
    return byTime || left.id.localeCompare(right.id);
  });
}

/** Loads only the next visible batch; reading never triggers a HealthKit import. */
export async function listLocalHealthObservationPage(
  cursor: import('@orot/storage').HealthObservationCursor | null = null,
  filter?: HealthObservationPageFilter,
) {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  const repository = await openLocalStorage();
  // Decode at most 100 selected-type rows without walking unrelated Watch
  // history. Denser periods retain bounded pagination.
  return repository.listHealthObservationPage(
    cursor,
    filter ? 100 : 50,
    filter,
  );
}
