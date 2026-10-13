import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { verifyIosTestCohortResults } from '../ios-test-cohort-results.mjs';

const context = { sourceSha: 'a'.repeat(40), runId: '101', attempt: '1' };
function report(cohort) {
  return {
    schemaVersion: 1,
    cohort,
    passed: true,
    ...context,
    tasks: iosTestCohortTasks(cohort).map((task) => ({
      profile: task.profile,
      suite: task.suite,
      status: 'passed',
      observations: task.identifiers.map((identifier) => ({
        identifier,
        result: 'Passed',
        duration: 1,
      })),
    })),
  };
}

test('Linux aggregation retains all first-attempt observations from each compatible cohort', () => {
  for (const [cohort, count] of [
    ['release', 50],
    ['speech', 11],
    ['debug', 17],
  ])
    assert.equal(verifyIosTestCohortResults(report(cohort), cohort, context).length, count);
});

test('missing, failed, cancelled-like, focused-only, repeated and stale receipts cannot produce a complete gate', () => {
  for (const mutate of [
    (value) => {
      value.passed = false;
    },
    (value) => {
      value.sourceSha = 'b'.repeat(40);
    },
    (value) => {
      value.runId = '100';
    },
    (value) => {
      value.attempt = '2';
    },
    (value) => {
      value.tasks.pop();
    },
    (value) => {
      value.tasks[0].status = 'cancelled';
    },
    (value) => {
      value.tasks[0].observations.pop();
    },
    (value) => {
      value.tasks[1] = value.tasks[0];
    },
    (value) => {
      value.tasks[0].observations[0].result = 'Skipped';
    },
  ]) {
    const value = report('release');
    mutate(value);
    assert.throws(() => verifyIosTestCohortResults(value, 'release', context));
  }
});
