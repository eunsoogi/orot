import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';
import { expandedActionSteps, workflow } from './fixtures/ios-workflow.mjs';

const full = () => workflow('.github/workflows/ios-test-validation.yml');
const read = (name) => workflow('.github/workflows/' + name);
const needs = (job) => (typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []));
function ancestors(jobs, id) {
  return needs(jobs[id]).flatMap((dependency) => [dependency, ...ancestors(jobs, dependency)]);
}

test('Debug, Release and OAuth consumers wait only for their corresponding separate producers', () => {
  const { jobs } = full();
  for (const id of [
    'production_validation',
    'debug_products',
    'release_products',
    'oauth_products',
  ])
    assert.equal(jobs[id].needs, 'plan');
  for (const configuration of ['debug', 'release']) {
    const consumer = jobs[configuration + '_execution'];
    assert.deepEqual(consumer.needs, ['plan', configuration + '_products']);
    assert.equal(consumer.uses, './.github/workflows/ios-test-cohort-execution.yml');
    assert.equal(
      consumer.with.archive_digest,
      '${{ needs.' + configuration + '_products.outputs.archive_digest }}',
    );
    assert.equal(
      consumer.with.manifest_digest,
      '${{ needs.' + configuration + '_products.outputs.manifest_digest }}',
    );
    assert.equal(consumer.strategy['fail-fast'], false);
    assert.equal(consumer.strategy['max-parallel'], undefined);
    assert.equal(
      consumer.strategy.matrix,
      '${{ fromJSON(needs.plan.outputs.' + configuration + '_matrix) }}',
    );
    assert.equal(consumer.if, undefined);
  }
  assert.equal(jobs.oauth_execution.needs, 'oauth_products');
  assert.equal(jobs.oauth_execution.uses, './.github/workflows/ios-oauth-execution.yml');
  assert.equal(jobs.debug_products.with.profile, 'provider-data');
  assert.equal(jobs.release_products.with.profile, 'core');
  assert.equal(jobs.plan['runs-on'], 'ubuntu-24.04');
  assert.equal(jobs.completeness['runs-on'], 'ubuntu-24.04');
});

test('the finite feature plan permits independent parallel jobs without repeating builds', () => {
  const { jobs } = full();
  const plan = iosTestExecutionPlan();
  const ids = Object.keys(jobs).filter((id) => !['plan', 'completeness'].includes(id));
  const weight = (id) =>
    id === 'debug_execution'
      ? plan.filter((entry) => entry.configuration === 'Debug').length
      : id === 'release_execution'
        ? plan.filter((entry) => entry.configuration === 'Release').length
        : 1;
  assert.equal(
    ids.reduce((total, id) => total + weight(id), 0),
    plan.length + 5,
  );
  // Enumerate dependency-compatible active job families. Matrix leaves share no dependency on one another.
  let maximum = 0;
  for (let bits = 0; bits < 1 << ids.length; bits++) {
    const active = ids.filter((_, index) => bits & (1 << index));
    if (
      active.every((id) => !ancestors(jobs, id).some((dependency) => active.includes(dependency)))
    )
      maximum = Math.max(
        maximum,
        active.reduce((total, id) => total + weight(id), 0),
      );
  }
  assert.equal(maximum, plan.length + 2);
  assert.deepEqual([...jobs.completeness.needs].sort(), ['plan', ...ids].sort());
  for (const id of ids) assert.equal(jobs[id].if, undefined);
});

test('test producers publish portable products without booting a Simulator or running tests', () => {
  const steps = read('ios-test-products-build.yml').jobs.validation.steps;
  assert.equal(
    steps.filter((step) => step.uses === './.github/actions/ios-test-products-build').length,
    1,
  );
  assert.ok(steps.every((step) => step.uses !== './.github/actions/ios-test-cohort-run'));
  assert.doesNotMatch(JSON.stringify(steps), /prepare-cohort|run-ios-tests|test-without-building/);
  const publication = steps.find(
    (step) => step.with?.path === 'artifacts/ios-focus/product-artifact',
  );
  assert.equal(publication.if, undefined);
  assert.equal(publication.with['if-no-files-found'], 'error');
  const diagnostics = steps.find((step) => step.name?.startsWith('Preserve build diagnostics'));
  assert.equal(diagnostics.if, 'always()');
  assert.ok(diagnostics.with.path.split('\n').includes('artifacts/ios-focus/*.log'));
  const execution = JSON.stringify(read('ios-test-cohort-execution.yml'));
  assert.match(execution, /actions\/download-artifact@/);
  assert.doesNotMatch(execution, /ios-test-products-build|build-ios-tests/);
});

test('the final gate rejects every failed, cancelled, skipped or missing prerequisite', () => {
  const { jobs } = full();
  const gate = jobs.completeness.steps.find((step) => step.env?.RESULTS);
  assert.equal(jobs.completeness.if, 'always()');
  const evaluate = new Function('process', gate.run.slice("node -e '".length, -1));
  const success = Object.fromEntries(
    jobs.completeness.needs.map((id) => [id, { result: 'success' }]),
  );
  assert.doesNotThrow(() => evaluate({ env: { RESULTS: JSON.stringify(success) } }));
  for (const id of jobs.completeness.needs) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined])
      assert.throws(() =>
        evaluate({ env: { RESULTS: JSON.stringify({ ...success, [id]: { result } }) } }),
      );
  }
});

test('each executor verifies artifacts before one boot and retains first-failure diagnostics', () => {
  const source = readFileSync('.github/actions/ios-test-cohort-run/action.yml', 'utf8');
  assert.equal((source.match(/ios-test-simulator\.mjs prepare-cohort/g) ?? []).length, 1);
  assert.ok(
    source.indexOf('Verify configuration, source and product integrity before boot') <
      source.indexOf('prepare-cohort'),
  );
  assert.match(source, /if: always\(\)[\s\S]*ios-test-simulator\.mjs cleanup/);
  assert.doesNotMatch(
    source,
    /continue-on-error|build-ios-tests\.mjs|test-iterations|prepare-ios-test-ui|DeviceHub/,
  );
  const action = workflow('.github/actions/ios-test-cohort-run/action.yml');
  const rejection = action.runs.steps.find((step) =>
    step.run?.includes('probe-ios-test-products.mjs'),
  );
  assert.equal(rejection.if, "inputs.cohort == 'core-integration'");
  const upload = action.runs.steps.find(
    (step) => step.name === 'Preserve all first-attempt diagnostics',
  );
  assert.equal(upload.if, 'always()');
  assert.ok(upload.with.path.split('\n').includes('artifacts/ios-cohort/results'));
  assert.ok(iosTestInventory('core').includes(hostConnectionTest));
});

test('production verifies actual tools before cache, Pods and its isolated app build', () => {
  const steps = expandedActionSteps('.github/actions/ios-production-validation/action.yml');
  const guard = steps.findIndex((step) => /verify-toolchain\.sh --cocoapods/.test(step.run ?? ''));
  assert.ok(guard >= 0);
  assert.equal(steps[guard].if, undefined);
  assert.equal(steps[guard]['continue-on-error'], undefined);
  for (const command of [
    'ios-derived-data-cache.mjs prepare production',
    'ios:pods',
    'build-ios-simulator-app.sh build',
  ])
    assert.ok(guard < steps.findIndex((step) => (step.run ?? '').includes(command)), command);
  const producer = read('ios-production-validation.yml');
  for (const step of steps.filter((value) =>
    /ios-derived-data-cache\.mjs (prepare|write) production/.test(value.run ?? ''),
  )) {
    const env = { ...producer.env, ...step.env };
    for (const name of [
      'IOS_CACHE_RUNNER_OS',
      'IOS_CACHE_RUNNER_ARCH',
      'MACOS_VERSION',
      'EXPECTED_NODE_VERSION',
      'EXPECTED_PNPM_VERSION',
      'EXPECTED_RUBY_VERSION',
      'EXPECTED_COCOAPODS_VERSION',
      'EXPECTED_XCODE_VERSION',
      'EXPECTED_IOS_SIMULATOR_SDK',
      'XCODEBUILD_FINGERPRINT',
    ])
      assert.ok(env[name], 'Missing production toolchain input: ' + name);
  }
});

test('full and focused execution retain one repository allocation window and separate build and test jobs', () => {
  assert.deepEqual(full().concurrency, {
    group: 'ios-ci-macos-${{ github.repository }}',
    'cancel-in-progress': false,
  });
  const focus = read('ios-focused.yml');
  assert.equal(focus.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.completeness['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.products.needs, 'selection');
  assert.equal(focus.jobs.execution.needs, 'products');
  assert.equal(Object.values(focus.jobs).filter((job) => job['runs-on'] === 'xcode-27').length, 2);
  for (const id of ['products', 'execution'])
    assert.deepEqual(focus.jobs[id].concurrency, full().concurrency);
});
