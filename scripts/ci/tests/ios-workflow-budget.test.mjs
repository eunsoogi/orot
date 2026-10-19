import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';
import {
  cohortJobs,
  completionJob,
  expandedActionSteps,
  workflow,
} from './fixtures/ios-workflow.mjs';

const full = () => workflow('.github/workflows/e2e-test.yml');
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
  const consumers = cohortJobs(jobs);
  const plan = iosTestExecutionPlan();
  assert.equal(consumers.length, plan.length);
  assert.deepEqual(
    consumers.map(([, job]) => job.inputs.cohort).sort(),
    plan.map((item) => item.cohort).sort(),
  );
  for (const [, { caller, leaf, inputs }] of consumers) {
    const entry = plan.find((item) => item.cohort === inputs.cohort);
    const configuration = entry.configuration.toLowerCase();
    assert.deepEqual(caller.needs, ['plan', configuration + '_products']);
    assert.equal(leaf.needs, undefined);
    assert.equal(leaf.name, entry.name);
    assert.equal(inputs.profile, entry.profile);
    assert.equal(leaf['timeout-minutes'], entry.minutes);
    assert.equal(inputs.artifact_name, 'ios-test-' + configuration + '-products');
    assert.equal(
      inputs.archive_digest,
      '${{ needs.' + configuration + '_products.outputs.archive_digest }}',
    );
    assert.equal(
      inputs.manifest_digest,
      '${{ needs.' + configuration + '_products.outputs.manifest_digest }}',
    );
    // Independent named calls cannot cancel siblings or append matrix parameters to visible names.
    assert.equal(caller.strategy, undefined);
    assert.equal(leaf.strategy, undefined);
    assert.equal(caller.if, '${{ needs.plan.outputs.has_' + configuration + " == 'true' }}");
    assert.equal(leaf.if, "${{ contains(fromJSON(inputs.cohorts), '" + inputs.cohort + "') }}");
  }
  assert.deepEqual(jobs.oauth_execution.needs, ['plan', 'oauth_products']);
  assert.equal(jobs.oauth_execution.uses, './.github/workflows/ios-oauth-execution.yml');
  assert.equal(jobs.debug_products.with.profile, 'provider-data');
  assert.equal(jobs.release_products.with.profile, 'core');
  assert.equal(jobs.plan['runs-on'], 'ubuntu-24.04');
  assert.equal(completionJob(jobs)['runs-on'], 'ubuntu-24.04');
});

test('the finite feature plan permits independent parallel jobs without repeating builds', () => {
  const { jobs } = full();
  const plan = iosTestExecutionPlan();
  const ids = jobs.completeness.needs.filter((id) => id !== 'plan');
  const cohorts = cohortJobs(jobs);
  const weight = (id) => cohorts.filter(([, job]) => job.callerId === id).length || 1;
  assert.equal(
    ids.reduce((sum, id) => sum + weight(id), 0),
    plan.length + 5,
  );
  // Enumerate producer-specific families; every leaf inside each family is independently scheduled.
  let maximum = 0;
  for (let bits = 0; bits < 1 << ids.length; bits++) {
    const active = ids.filter((_, index) => bits & (1 << index));
    if (
      active.every((id) => !ancestors(jobs, id).some((dependency) => active.includes(dependency)))
    )
      maximum = Math.max(
        maximum,
        active.reduce((sum, id) => sum + weight(id), 0),
      );
  }
  assert.equal(maximum, plan.length + 2);
  assert.deepEqual([...jobs.completeness.needs].sort(), ['plan', ...ids].sort());
  assert.equal(jobs.production_validation.if, undefined);
  assert.equal(jobs.debug_products.if, "${{ needs.plan.outputs.has_debug == 'true' }}");
  assert.equal(jobs.release_products.if, "${{ needs.plan.outputs.has_release == 'true' }}");
  assert.equal(jobs.oauth_products.if, "${{ needs.plan.outputs.oauth_required == 'true' }}");
  assert.equal(jobs.debug_execution.if, "${{ needs.plan.outputs.has_debug == 'true' }}");
  assert.equal(jobs.release_execution.if, "${{ needs.plan.outputs.has_release == 'true' }}");
  assert.equal(jobs.oauth_execution.if, "${{ needs.plan.outputs.oauth_required == 'true' }}");
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
  const execution = JSON.stringify(workflow('.github/actions/ios-test-cohort-executor/action.yml'));
  assert.match(execution, /actions\/download-artifact@/);
  assert.doesNotMatch(execution, /ios-test-products-build|build-ios-tests/);
});

test('the completeness workflow passes selected run evidence to its exact validator', () => {
  const { jobs } = full();
  const completion = completionJob(jobs);
  const gate = completion.steps.find((step) => step.name?.includes('Require selected producers'));
  assert.equal(jobs.completeness.if, "${{ always() && needs.plan.result != 'skipped' }}");
  assert.equal(jobs.completeness.with.execution_results, '${{ toJSON(needs) }}');
  assert.equal(
    jobs.completeness.with.selected_cohorts,
    '${{ needs.plan.outputs.selected_cohorts }}',
  );
  assert.equal(
    jobs.completeness.with.oauth_required,
    "${{ needs.plan.outputs.oauth_required == 'true' }}",
  );
  assert.equal(completion.if, 'always()');
  assert.equal(gate.env.OROT_IOS_EXECUTION_RESULTS, '${{ inputs.execution_results }}');
  assert.equal(gate.env.OROT_IOS_TEST_COHORTS, '${{ inputs.selected_cohorts }}');
  assert.equal(gate.env.OROT_IOS_OAUTH_TESTS, '${{ inputs.oauth_required }}');
  assert.equal(gate.run, 'node scripts/ci/ios-test-execution-completeness.mjs');
  const resultsUpload = completion.steps.find((step) =>
    step.name?.includes('Preserve verified selected results'),
  );
  assert.equal(resultsUpload.if, undefined);
  assert.equal(resultsUpload.with.path, 'artifacts/ios-reports/complete.json');
});

test('each executor verifies artifacts before one boot and retains first-failure diagnostics', () => {
  const source = readFileSync('.github/actions/ios-test-cohort-run/action.yml', 'utf8');
  assert.equal((source.match(/ios-test-simulator\.mjs prepare-cohort/g) ?? []).length, 1);
  assert.ok(
    source.indexOf('Verify configuration, source and product integrity before boot') <
      source.indexOf('prepare-cohort'),
  );
  assert.match(source, /if: always\(\)[\s\S]*ios-test-simulator\.mjs cleanup/);
  assert.doesNotMatch(source, /continue-on-error|build-ios-tests\.mjs|test-iterations/);
  const action = workflow('.github/actions/ios-test-cohort-run/action.yml');
  const uiPreparation = action.runs.steps.find(
    (step) => step.name === 'Verify Questions UI host preparation before fixture execution',
  );
  assert.ok(uiPreparation, 'Questions cohort must run the separate UI host preparation');
  assert.equal((source.match(/prepare-ios-test-ui\.mjs/g) ?? []).length, 1);
  assert.equal(uiPreparation.if, "inputs.cohort == 'questions'");
  assert.deepEqual(uiPreparation.env, {
    PROFILE: '${{ inputs.profile }}',
    TEST_RUN: '${{ steps.verify.outputs.test_run }}',
  });
  assert.equal(
    uiPreparation.run,
    'scripts/ci/run-command.sh ios-questions-ui-preparation artifacts/ios-cohort/ui-preparation.log -- node scripts/ci/prepare-ios-test-ui.mjs "$PROFILE" "$TEST_RUN" artifacts/ios-cohort/simulator-owner.json artifacts/ios-cohort/ui-preparation',
  );
  const bootIndex = action.runs.steps.findIndex((step) =>
    step.run?.includes('ios-test-simulator.mjs prepare-cohort'),
  );
  const preparationIndex = action.runs.steps.indexOf(uiPreparation);
  const testIndex = action.runs.steps.findIndex((step) =>
    step.run?.includes('run-ios-test-cohort.mjs'),
  );
  assert.ok(bootIndex < preparationIndex && preparationIndex < testIndex);
  // Keep preflight xcresult and screenshot evidence outside the planned cohort results.
  const rejection = action.runs.steps.find((step) =>
    step.run?.includes('probe-ios-test-products.mjs'),
  );
  assert.equal(rejection.if, "inputs.cohort == 'core-integration'");
  const upload = action.runs.steps.find(
    (step) => step.name === 'Preserve all first-attempt diagnostics',
  );
  assert.equal(upload.if, 'always()');
  assert.ok(upload.with.path.split('\n').includes('artifacts/ios-cohort/results'));
  assert.ok(upload.with.path.split('\n').includes('artifacts/ios-cohort/ui-preparation'));
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
    queue: 'max',
    'cancel-in-progress': false,
  });
  const focus = read('ios-focused.yml');
  assert.equal(focus.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.completeness['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.products.needs, 'selection');
  assert.equal(focus.jobs.execution.needs, 'products');
  assert.equal(Object.values(focus.jobs).filter((job) => job['runs-on'] === 'xcode-27').length, 2);
  for (const id of ['products', 'execution']) assert.equal(focus.jobs[id].concurrency, undefined);
});
