import { verifyIosFixtureReceipt } from './ios-test-fixture-receipt.mjs';

export const fixtureIsolationTests = [
  'OrotIntegrationTests/FixtureIsolationTests/testSeedActualEncryptedDatabaseBeforeScopedReset',
  'OrotIntegrationTests/FixtureIsolationTests/testScopedResetRemovesPollutionBeforeNewDatabaseOpen',
];

/** Preferences are deliberately contaminated and reset by this exact native host, not transferred through another process's defaults cache. */
function nativePreparation(result, token) {
  const receipt = verifyIosFixtureReceipt(result.reset, 'reset', token);
  const names = Object.keys(receipt.state.preferences);
  if (
    receipt.processIdentifier !== result.processIdentifier ||
    receipt.before?.foreignPreference !== true ||
    receipt.state.foreignPreference !== true ||
    Object.keys(receipt.before?.preferences ?? {}).length !== names.length ||
    !names.every((key) => receipt.before.preferences[key] === true)
  )
    throw new Error(
      'Native preparation must observe its own preference contamination, scoped reset and preserved foreign preference',
    );
  return receipt;
}

/** Contaminate after a verified real SQL seed; each later step is withheld after the first failure. */
export async function executeFixtureIsolationPhases({ token, run, pollute }) {
  const seeded = await run(fixtureIsolationTests[0]);
  nativePreparation(seeded, token);
  const polluted = await pollute();
  if (polluted.state.keyFingerprint !== seeded.state.keyFingerprint)
    throw new Error('Fixture contamination changed the real database key');
  const verified = await run(fixtureIsolationTests[1], seeded);
  const cleaned = nativePreparation(verified, token);
  if (cleaned.state.foreignFile !== true || cleaned.state.foreignKey !== true)
    throw new Error('Native scoped reset removed unrelated file or Keychain sentinels');
  if (
    verified.processIdentifier === seeded.processIdentifier ||
    verified.result?.oldRecordAbsent !== true ||
    verified.after?.foreignFile !== true ||
    verified.after?.foreignKey !== true ||
    verified.after?.foreignPreference !== true ||
    !verified.after?.keyFingerprint ||
    verified.after.keyFingerprint === seeded.state.keyFingerprint
  )
    throw new Error('Scoped isolation did not prove a new process, clean data and renewed key');
  return { seeded, polluted, cleaned, verified };
}
