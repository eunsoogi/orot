import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { workflow } from './fixtures/ios-workflow.mjs';

// Inspect executable leaves, including producer and nested cohort jobs: a wrapper has no timeout of its own.
function leaves(path, inputs = {}, parents = []) {
  return Object.entries(workflow(path).jobs).flatMap(([id, job]) => {
    const name = [...parents, job.name ?? id];
    const resolve = (value) =>
      typeof value === 'string'
        ? value.replace(/\$\{\{ inputs\.(\w+) \}\}/g, (_, key) => inputs[key])
        : value;
    if (job.uses?.startsWith('./.github/workflows/')) {
      const forwarded = Object.fromEntries(
        Object.entries(job.with ?? {}).map(([key, value]) => [key, resolve(value)]),
      );
      return leaves(job.uses, forwarded, name);
    }
    return [{ name: name.join(' / '), minutes: Number(resolve(job['timeout-minutes'])) }];
  });
}

test('nightly cohort and authentication jobs retain hard limits of at most 20 minutes', () => {
  const jobs = leaves('.github/workflows/e2e-test.yml');
  assert.ok(jobs.length > 0);
  for (const job of jobs)
    assert.ok(
      Number.isFinite(job.minutes) && job.minutes > 0 && job.minutes <= 20,
      `${job.name} has an invalid hard limit: ${job.minutes}`,
    );
});

test('the hosted execution plan never advertises a test allowance above 20 minutes', () => {
  for (const job of iosTestExecutionPlan()) assert.equal(job.minutes, 20, job.cohort);
});

for (const [suite, count] of [
  ['navigation', 4],
  ['recordings', 3],
  ['calendar', 2],
]) {
  test(`${suite} partitions intact XCTest methods without omitting or repeating observations`, () => {
    const jobs = iosTestExecutionPlan().filter((job) => job.cohort.startsWith(suite + '-'));
    assert.equal(jobs.length, count);
    const identifiers = jobs.flatMap((job) =>
      iosTestCohortTasks(job.cohort).flatMap((task) => task.identifiers),
    );
    const original = iosTestCohortTasks(suite).flatMap((task) => task.identifiers);
    assert.deepEqual(identifiers.slice().sort(), original.slice().sort());
    assert.equal(new Set(identifiers).size, identifiers.length);
    for (const job of jobs) {
      const tasks = iosTestCohortTasks(job.cohort);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].mode, 'fixture');
      assert.ok(tasks[0].identifiers.length > 0);
    }
  });
}

test('selected fixture groups use the same independent leaves instead of one aggregate VM', () => {
  const { jobs } = workflow('.github/workflows/ios-focused.yml');
  assert.equal(jobs.fixture_execution?.uses, './.github/workflows/ios-release-tests.yml');
  assert.equal(jobs.fixture_execution.with.cohorts, '${{ needs.products.outputs.cohorts }}');
  assert.equal(jobs.fixture_execution.with.artifact_name, 'ios-focused-products');
  assert.equal(jobs.execution.if, "${{ needs.products.outputs.cohorts == '[]' }}");
});

// Keep the long large-text journey intact, with its own setup and cleanup allowance.
test('large-text navigation has an independent hard-limited job', () => {
  const ids = iosTestCohortTasks('navigation-accessibility').flatMap((task) => task.identifiers);
  assert.deepEqual(ids, [
    'OrotUITests/RootNavigationUITests/testLargeTextKeepsRootTabsAndRecordingActionsReachable',
  ]);
  const job = workflow('.github/workflows/ios-navigation-tests.yml').jobs.accessibility;
  assert.equal(job['timeout-minutes'], 20);
  assert.equal(
    job.steps.find((step) => step.uses === './.github/actions/ios-test-cohort-executor').with
      .cohort,
    'navigation-accessibility',
  );
});

// Whole original journeys keep their own setup/reset/cleanup; only independent methods change VM ownership.
test('recording leaves schedule controls, transcript review and playback with complete method coverage', () => {
  const { jobs } = workflow('.github/workflows/ios-recording-tests.yml');
  assert.deepEqual(Object.keys(jobs), [
    'encounter_review_persistence',
    'controls',
    'review',
    'playback',
  ]);
  for (const [id, count] of [
    ['controls', 6],
    ['review', 2],
    ['playback', 2],
  ]) {
    const cohort = `recordings-${id}`;
    assert.equal(iosTestCohortTasks(cohort)[0].identifiers.length, count);
    assert.equal(jobs[id]['timeout-minutes'], 20);
    assert.equal(jobs[id].if, "${{ contains(fromJSON(inputs.cohorts), '" + cohort + "') }}");
    const executor = jobs[id].steps.find(
      (step) => step.uses === './.github/actions/ios-test-cohort-executor',
    );
    assert.equal(executor.with.cohort, cohort);
    assert.equal(executor.with.profile, 'fixtures');
  }
  const review = jobs.encounter_review_persistence;
  assert.equal(
    review.if,
    "${{ contains(fromJSON(inputs.cohorts), 'encounter-review-persistence') }}",
  );
  const executor = review.steps.find(
    (step) => step.uses === './.github/actions/ios-test-cohort-executor',
  );
  assert.equal(executor.with.cohort, 'encounter-review-persistence');
  assert.equal(executor.with.profile, 'core');
  assert.equal(review['timeout-minutes'], 20);
});
