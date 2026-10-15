export const fixtureIsolationTests = [
  'OrotIntegrationTests/FixtureIsolationTests/testSeedActualEncryptedDatabaseBeforeScopedReset',
  'OrotIntegrationTests/FixtureIsolationTests/testScopedResetRemovesPollutionBeforeNewDatabaseOpen',
];

/** Contaminate after a verified real SQL seed; each later step is withheld after the first failure. */
export async function executeFixtureIsolationPhases({ reset, run, pollute }) {
  await reset();
  const seeded = await run(fixtureIsolationTests[0]);
  const polluted = await pollute();
  if (polluted.state.keyFingerprint !== seeded.state.keyFingerprint)
    throw new Error('Fixture contamination changed the real database key');
  const cleaned = await reset();
  if (cleaned.state.foreignFile !== true || cleaned.state.foreignKey !== true)
    throw new Error('Scoped reset removed unrelated sentinels');
  const verified = await run(fixtureIsolationTests[1], seeded);
  if (
    verified.processIdentifier === seeded.processIdentifier ||
    verified.result?.oldRecordAbsent !== true ||
    verified.after?.foreignFile !== true ||
    verified.after?.foreignKey !== true ||
    !verified.after?.keyFingerprint ||
    verified.after.keyFingerprint === seeded.state.keyFingerprint
  )
    throw new Error('Scoped isolation did not prove a new process, clean data and renewed key');
  return { seeded, polluted, cleaned, verified };
}
