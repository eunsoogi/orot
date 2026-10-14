import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productionObligations,
  verifyProductionReceipt,
} from '../ios-production-receipt-policy.mjs';

const env = {
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
};
const receipt = () => ({
  schemaVersion: 1,
  sourceSha: env.GITHUB_SHA,
  runId: env.GITHUB_RUN_ID,
  attempt: env.GITHUB_RUN_ATTEMPT,
  profile: 'production',
  configuration: 'Debug',
  entry: 'index.js',
  flags: 'default',
  derivedData: 'apps/mobile/ios/build-production',
  inputDigest: 'b'.repeat(64),
  appArtifacts: {
    appBinarySha256: 'c'.repeat(64),
    infoPlistSha256: 'd'.repeat(64),
  },
  obligations: Object.fromEntries(productionObligations().map((name) => [name, 'passed'])),
});

// This is schema policy proof, not an actual production build or hosted receipt observation.
test('current production and OAuth receipt does not depend on unrelated native test outcomes', () => {
  assert.equal(verifyProductionReceipt(receipt(), env).sourceSha, env.GITHUB_SHA);
});

test('stale, partial, incompatible and absent proof cannot satisfy the production context', () => {
  for (const [key, value] of [
    ['sourceSha', 'f'.repeat(40)],
    ['runId', '124'],
    ['attempt', '2'],
    ['configuration', 'Release'],
    ['entry', 'e2e/testEntry.tsx'],
    ['flags', 'OROT_TESTS'],
    ['derivedData', 'artifacts/native-focus/DerivedData'],
    ['inputDigest', ''],
  ])
    assert.throws(() => verifyProductionReceipt({ ...receipt(), [key]: value }, env));
  for (const stage of productionObligations()) {
    for (const status of ['failed', 'skipped', 'cancelled', 'not-run']) {
      const changed = receipt();
      changed.obligations[stage] = status;
      assert.throws(() => verifyProductionReceipt(changed, env));
    }
    const missing = receipt();
    delete missing.obligations[stage];
    assert.throws(() => verifyProductionReceipt(missing, env));
  }
  assert.throws(() => verifyProductionReceipt({ ...receipt(), appArtifacts: {} }, env));
  assert.throws(() => verifyProductionReceipt(receipt(), { ...env, GITHUB_SHA: '' }));
});
