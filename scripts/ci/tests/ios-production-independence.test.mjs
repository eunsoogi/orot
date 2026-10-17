import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cohortJobs, completionJob } from './fixtures/ios-workflow.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const read = (path) => yaml.load(readFileSync(path, 'utf8'));
const full = () => read('.github/workflows/e2e-test.yml');

// Follow actual local actions so moving a production step into a helper cannot hide a serial prerequisite.
function commands(steps) {
  return steps.flatMap((step) =>
    step.uses?.startsWith('./.github/actions/')
      ? commands(read(step.uses + '/action.yml').runs.steps)
      : step.run
        ? [step.run]
        : [],
  );
}

function ancestors(jobs, id) {
  const needs = jobs[id].needs ?? [];
  return (Array.isArray(needs) ? needs : [needs]).flatMap((dependency) => [
    dependency,
    ...ancestors(jobs, dependency),
  ]);
}

test('production and OAuth remain mandatory without delaying test-product consumers', () => {
  const { jobs } = full();
  assert.ok(jobs.production_validation, 'A separate production obligation is required');
  assert.equal(jobs.production_validation.needs, 'plan');
  assert.equal(jobs.production_validation.if, undefined);
  assert.equal(jobs.release_products.needs, 'plan');
  for (const id of [
    'debug_products',
    'release_products',
    ...new Set(cohortJobs(jobs).map(([, job]) => job.callerId)),
    'oauth_products',
    'oauth_execution',
  ]) {
    assert.ok(!ancestors(jobs, id).includes('production_validation'), id);
  }
  assert.ok(jobs.completeness.needs.includes('production_validation'));
  const production = read(jobs.production_validation.uses).jobs.validation;
  assert.equal(production['runs-on'], 'xcode-27');
  const source = commands(production.steps).join('\n');
  for (const obligation of [
    'build-ios-simulator-app.sh build',
    'verify-apple-model-product.mjs production',
    'verify-simulator-keychain-defaults.mjs',
  ]) {
    assert.ok(source.includes(obligation), obligation);
    assert.ok(source.indexOf(obligation) < source.indexOf('ios-production-receipt.mjs write'));
  }
  assert.doesNotMatch(
    source,
    /build-ios-tests|run-ios-tests|prepare-cohort|swift test|ChatGPTOAuthSpike/,
  );
  const oauthBuild = commands(read(jobs.oauth_products.uses).jobs.build.steps).join('\n');
  const oauthTest = commands(read(jobs.oauth_execution.uses).jobs.execution.steps).join('\n');
  assert.match(oauthBuild, /swift build[^\n]+--build-tests/);
  assert.match(oauthBuild, /ChatGPTOAuthSpike.xcodeproj/);
  assert.match(oauthBuild, /swift test[^\n]+list --skip-build/);
  assert.doesNotMatch(oauthBuild, /oauth-test-products.mjs execute|xcrun xctest/);
  assert.match(oauthTest, /oauth-test-products.mjs execute/);
  assert.doesNotMatch(oauthTest, /swift build|swift test|xcodebuild/);
  assert.equal(jobs.oauth_execution.needs, 'oauth_products');
  assert.ok(jobs.completeness.needs.includes('oauth_execution'));
});

test('portable test producers never compile or cache unrelated production or OAuth products', () => {
  const producer = read('.github/actions/ios-test-products-build/action.yml');
  const source = commands(producer.runs.steps).join('\n');
  assert.match(source, /build-ios-tests\.mjs/);
  assert.match(source, /verify-apple-model-product\.mjs integration-test/);
  assert.match(source, /ios-test-products\.mjs create/);
  assert.doesNotMatch(
    source,
    /build-ios-simulator-app|swift test|ChatGPTOAuthSpike|ios-derived-data-cache|ios-production-receipt/,
  );
  assert.equal(producer.inputs.production_build, undefined);
});

test('production failure, cancellation, skip or a missing result keeps final validation red', () => {
  const { jobs } = full();
  assert.ok(jobs.completeness.needs.includes('production_validation'));
  const gate = completionJob(jobs).steps.find((step) => step.env?.RESULTS);
  const evaluate = new Function('process', gate.run.slice("node -e '".length, -1));
  const success = Object.fromEntries(
    jobs.completeness.needs.map((id) => [id, { result: 'success' }]),
  );
  assert.doesNotThrow(() => evaluate({ env: { RESULTS: JSON.stringify(success) } }));
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() =>
      evaluate({
        env: { RESULTS: JSON.stringify({ ...success, production_validation: { result } }) },
      }),
    );
  }
});
