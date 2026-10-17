import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

const verifyFullProductionReceipt = (build = receipt(), oauthReceipt = oauth()) =>
  verifyProductionReceipt(build, env, { oauthRequired: true, oauthReceipt });

// This is schema policy proof, not an actual production build or hosted receipt observation.
test('current production and OAuth receipt does not depend on unrelated integration test outcomes', () => {
  assert.equal(verifyProductionBuildReceipt(receipt(), env).sourceSha, env.GITHUB_SHA);
  assert.deepEqual(Object.keys(verifyFullProductionReceipt().obligations), productionObligations());
  assert.throws(() => verifyProductionReceipt(receipt(), env, { oauthRequired: true }), /OAuth/);
  for (const field of ['sourceSha', 'runId', 'attempt']) {
    const changed = oauth();
    changed.context[field] += '1';
    assert.throws(
      () => verifyProductionReceipt(receipt(), env, { oauthRequired: true, oauthReceipt: changed }),
      /OAuth/,
    );
  }
  assert.throws(() =>
    verifyProductionReceipt(receipt(), env, {
      oauthRequired: true,
      oauthReceipt: { ...oauth(), passed: false },
    }),
  );
});

test('selected production verification requires an OAuth receipt only for OAuth selections', () => {
  const buildOnly = verifyProductionReceipt(receipt(), env, { oauthRequired: false });
  assert.deepEqual(Object.keys(buildOnly.obligations).sort(), productionBuildObligations().sort());
  assert.throws(() => verifyProductionReceipt(receipt(), env, { oauthRequired: true }), /OAuth/);
  assert.deepEqual(Object.keys(verifyFullProductionReceipt().obligations), productionObligations());
  assert.throws(
    () =>
      verifyProductionReceipt(receipt(), env, {
        oauthRequired: false,
        oauthReceipt: oauth(),
      }),
    /unexpected OAuth/i,
  );
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
    assert.throws(() => verifyFullProductionReceipt({ ...receipt(), [key]: value }));
  for (const stage of productionBuildObligations()) {
    for (const status of ['failed', 'skipped', 'cancelled', 'not-run']) {
      const changed = receipt();
      changed.obligations[stage] = status;
      assert.throws(() => verifyFullProductionReceipt(changed));
    }
    const missing = receipt();
    delete missing.obligations[stage];
    assert.throws(() => verifyFullProductionReceipt(missing));
  }
  assert.throws(() => verifyFullProductionReceipt({ ...receipt(), appArtifacts: {} }));
  assert.throws(() =>
    verifyProductionReceipt(
      receipt(),
      { ...env, GITHUB_SHA: '' },
      {
        oauthRequired: true,
        oauthReceipt: oauth(),
      },
    ),
  );
});

test('the production receipt CLI applies the explicit OAuth decision to current-run receipts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-production-receipt-'));
  const buildPath = join(directory, 'production.json');
  const oauthPath = join(directory, 'oauth.json');
  writeFileSync(buildPath, JSON.stringify(receipt()));
  writeFileSync(oauthPath, JSON.stringify(oauth()));

  const run = (oauthRequired, receiptPath, build = receipt(), oauthReceipt = oauth()) => {
    writeFileSync(buildPath, JSON.stringify(build));
    writeFileSync(oauthPath, JSON.stringify(oauthReceipt));
    const envForCli = { ...process.env, ...env };
    if (oauthRequired === undefined) delete envForCli.OROT_IOS_OAUTH_REQUIRED;
    else envForCli.OROT_IOS_OAUTH_REQUIRED = oauthRequired;
    if (receiptPath === undefined) delete envForCli.OROT_IOS_OAUTH_RECEIPT_PATH;
    else envForCli.OROT_IOS_OAUTH_RECEIPT_PATH = receiptPath;
    return spawnSync(
      process.execPath,
      [resolve('scripts/ci/ios-production-receipt.mjs'), 'verify', buildPath],
      { cwd: process.cwd(), encoding: 'utf8', env: envForCli },
    );
  };

  try {
    assert.equal(run('false').status, 0, 'a build-only selection needs no OAuth artifact');
    assert.equal(run('true', oauthPath).status, 0, 'a full selection validates its OAuth artifact');
    assert.notEqual(run('true').status, 0, 'a required OAuth artifact cannot be omitted');
    assert.notEqual(
      run('true', oauthPath, { ...receipt(), sourceSha: 'f'.repeat(40) }).status,
      0,
      'the production artifact must match the current source for OAuth selections',
    );
    assert.notEqual(
      run('false', undefined, { ...receipt(), sourceSha: 'f'.repeat(40) }).status,
      0,
      'the production artifact must match the current source for build-only selections',
    );
    assert.notEqual(
      run('true', oauthPath, receipt(), { ...oauth(), passed: false }).status,
      0,
      'a selected OAuth artifact must show successful execution',
    );
    assert.notEqual(
      run('true', oauthPath, receipt(), {
        ...oauth(),
        context: { ...oauth().context, runId: '124' },
      }).status,
      0,
      'a selected OAuth artifact must match the current run',
    );
    assert.notEqual(run(undefined).status, 0, 'the OAuth selection decision is mandatory');
    assert.notEqual(run('').status, 0, 'an empty OAuth decision is invalid');
    assert.notEqual(run('maybe').status, 0, 'an unknown OAuth decision is invalid');
    assert.notEqual(
      run('false', oauthPath).status,
      0,
      'a non-OAuth selection cannot consume an unexpected OAuth artifact',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
