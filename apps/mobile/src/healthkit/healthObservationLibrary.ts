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
