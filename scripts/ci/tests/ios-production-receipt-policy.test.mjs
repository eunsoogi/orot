import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productionObligations,
  productionBuildObligations,
  verifyProductionBuildReceipt,
  verifyProductionReceipt,
} from '../ios-production-receipt-policy.mjs';

const env = {
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
};
const receipt = () => ({
  schemaVersion: 2,
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
  obligations: Object.fromEntries(productionBuildObligations().map((name) => [name, 'passed'])),
});

const oauth = () => ({
  schemaVersion: 1,
  passed: true,
  context: {
    sourceSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    profile: 'oauth-macos',
    configuration: 'Debug',
    inputDigest: 'e'.repeat(64),
  },
  tests: ['OpenAIProviderTests.OAuthTests/testToken'],
  archiveDigest: 'f'.repeat(64),
  manifestDigest: '1'.repeat(64),
  harnessBinaryDigest: '2'.repeat(64),
});

// This is schema policy proof, not an actual production build or hosted receipt observation.
test('current production and OAuth receipt does not depend on unrelated integration test outcomes', () => {
  assert.equal(verifyProductionBuildReceipt(receipt(), env).sourceSha, env.GITHUB_SHA);
  assert.deepEqual(
    Object.keys(verifyProductionReceipt(receipt(), env, oauth()).obligations),
    productionObligations(),
  );
  assert.throws(() => verifyProductionReceipt(receipt(), env), /OAuth/);
  for (const field of ['sourceSha', 'runId', 'attempt']) {
    const changed = oauth();
    changed.context[field] += '1';
    assert.throws(() => verifyProductionReceipt(receipt(), env, changed), /OAuth/);
  }
  assert.throws(() => verifyProductionReceipt(receipt(), env, { ...oauth(), passed: false }));
});

test('stale, partial, incompatible and absent proof cannot satisfy the production context', () => {
  for (const [key, value] of [
    ['sourceSha', 'f'.repeat(40)],
    ['runId', '124'],
    ['attempt', '2'],
    ['configuration', 'Release'],
    ['entry', 'e2e/testEntry.tsx'],
    ['flags', 'OROT_TESTS'],
    ['derivedData', 'artifacts/ios-focus/DerivedData'],
    ['inputDigest', ''],
  ])
    assert.throws(() => verifyProductionReceipt({ ...receipt(), [key]: value }, env, oauth()));
  for (const stage of productionBuildObligations()) {
    for (const status of ['failed', 'skipped', 'cancelled', 'not-run']) {
      const changed = receipt();
      changed.obligations[stage] = status;
      assert.throws(() => verifyProductionReceipt(changed, env, oauth()));
    }
    const missing = receipt();
    delete missing.obligations[stage];
    assert.throws(() => verifyProductionReceipt(missing, env, oauth()));
  }
  assert.throws(() => verifyProductionReceipt({ ...receipt(), appArtifacts: {} }, env, oauth()));
  assert.throws(() => verifyProductionReceipt(receipt(), { ...env, GITHUB_SHA: '' }, oauth()));
});
