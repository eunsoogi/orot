/** Keep graph-only and production-review probes separate while sharing the native operation dispatch boundary. */
export async function runEncounterTestOperation(
  operation: string,
  parameters: Record<string, unknown>,
) {
  if (operation === 'encounter-review-persistence') {
    const { runEncounterReviewPersistenceOperation } =
      await import('./encounterReviewPersistenceOperation');
    return runEncounterReviewPersistenceOperation(
      parameters.mode,
      parameters.fixtureIdentifier,
    );
  }
  if (operation === 'encounter-persistence') {
    const { runEncounterPersistenceOperation } =
      await import('./encounterPersistenceOperation');
    return runEncounterPersistenceOperation(
      parameters.mode,
      parameters.fixtureIdentifier,
    );
  }
  throw new Error('Unknown encounter test operation.');
}
