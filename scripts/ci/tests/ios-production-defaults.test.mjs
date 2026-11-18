import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyProductionDefaults } from '../ios-production-defaults-policy.mjs';
import { workflow, expandedActionSteps } from './fixtures/ios-workflow.mjs';

const env = { GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
const context = {
  sourceSha: env.GITHUB_SHA,
  runId: '123',
  attempt: '1',
  inputDigest: 'b'.repeat(64),
  signingInputDigest: 'c'.repeat(64),
  xcode: 'Xcode 27.2\nBuild version 18A123',
  sdk: '27.2',
  developerDirectory: '/Applications/Xcode_27.2.app/Contents/Developer',
};
const receipt = () => ({
  schemaVersion: 1,
  passed: true,
  obligation: 'simulator-keychain-defaults',
  context: { ...context },
});

test('same-run defaults require exact source, input and actual toolchain identity', () => {
  assert.doesNotThrow(() => verifyProductionDefaults(receipt(), env, context));
  for (const key of Object.keys(context)) {
    const changed = receipt();
    changed.context[key] += 'x';
    assert.throws(() => verifyProductionDefaults(changed, env, context));
  }
  for (const value of [
    undefined,
    null,
    {},
    { ...receipt(), passed: false },
    { ...receipt(), obligation: 'production-app' },
    { ...receipt(), schemaVersion: 2 },
  ])
    assert.throws(() => verifyProductionDefaults(value, env, context));
  for (const status of ['failed', 'skipped', 'cancelled', 'passed'])
    assert.throws(() => verifyProductionDefaults({ ...receipt(), passed: status }, env, context));
});

test('defaults retain the real workspace queries in a finite prerequisite with no duplicate build', () => {
  const { defaults, validation } = workflow('.github/workflows/ios-production-validation.yml').jobs;
  assert.equal(defaults['timeout-minutes'], 20);
  assert.equal(validation['timeout-minutes'], 20);
  assert.equal(validation.needs, 'defaults');
  assert.equal(validation.if, undefined); // Failure, cancellation or skip cannot start the producer.
  for (const job of [defaults, validation]) assert.equal(job['continue-on-error'], undefined);
  const source = JSON.stringify(defaults.steps);
  assert.match(source, /ios-platform-dependencies/);
  assert.doesNotMatch(source, /build-ios-simulator-app|build-ios-tests|continue-on-error/);
  const receiptSource = readFileSync('scripts/ci/ios-production-defaults-receipt.mjs', 'utf8');
  assert.ok(
    receiptSource.indexOf("['scripts/ci/verify-simulator-keychain-defaults.mjs']") <
      receiptSource.indexOf('writeFileSync(path'),
  );
  const original = readFileSync('scripts/ci/verify-simulator-keychain-defaults.mjs', 'utf8');
  assert.match(original, /'Debug', 'Release'/);
  assert.match(original, /'iphonesimulator'/);
  assert.match(original, /'iphoneos'/);
  const upload = defaults.steps.find((step) =>
    step.with?.name?.startsWith('ios-production-defaults-${'),
  );
  assert.equal(upload.if, undefined);
  assert.equal(upload.with['if-no-files-found'], 'error');
  const download = validation.steps.find((step) =>
    step.uses?.startsWith('actions/download-artifact@'),
  );
  assert.equal(download.with.name, upload.with.name);
  assert.equal(download['continue-on-error'], undefined);
  const steps = expandedActionSteps('.github/actions/ios-production-validation/action.yml');
  assert.ok(!steps.some((step) => step.run?.includes('verify-simulator-keychain-defaults.mjs')));
});
