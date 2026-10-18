import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

test('independent feature suites have distinct jobs and preserve all registered observations', () => {
  const plan = iosTestExecutionPlan();
  assert.equal(plan.length, 15);
  assert.equal(new Set(plan.map((job) => job.name)).size, plan.length);
  assert.equal(plan.filter((job) => job.configuration === 'Debug').length, 4);
  const actual = plan.flatMap((job) =>
    iosTestCohortTasks(job.cohort).flatMap((task) => task.identifiers),
  );
  const original = ['release', 'debug', 'speech'].flatMap((name) =>
    iosTestCohortTasks(name).flatMap((task) => task.identifiers),
  );
  assert.equal(actual.length, 94);
  assert.deepEqual(actual.slice().sort(), original.slice().sort());
});

test('new process, reset, restore and Speech preparation dependencies remain inside their required task drivers', () => {
  for (const [cohort, modes] of [
    ['persistence', ['shared-persistence']],
    ['isolation', ['fixture-isolation']],
    ['backup', ['backup']],
    ['local-model', ['local-model']],
    ['speech', ['plain', 'plain', 'speech-journey']],
  ])
    assert.deepEqual(
      iosTestCohortTasks(cohort).map((task) => task.mode),
      modes,
    );
  for (const name of ['navigation', 'recordings', 'questions', 'calendar']) {
    const tasks = iosTestCohortTasks(name);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].suite, name);
    assert.equal(tasks[0].mode, 'fixture');
  }
});

test('selected plans retain full original task groups while omitting unrelated cohorts', () => {
  const selected = iosTestExecutionPlan(['backup', 'recordings']);
  const actual = selected.flatMap((job) =>
    iosTestCohortTasks(job.cohort).flatMap((task) => task.identifiers),
  );
  const expected = ['backup', 'recordings'].flatMap((cohort) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  );

  assert.deepEqual(
    selected.map((job) => job.cohort),
    ['backup', 'recordings'],
  );
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  assert.equal(
    selected.some((job) => job.cohort === 'speech'),
    false,
  );
});

test('invalid, empty, duplicated or unknown selections cannot create a partial plan', () => {
  for (const selected of [[], ['backup', 'backup'], ['not-a-cohort']])
    assert.throws(() => iosTestExecutionPlan(selected), /unique known cohorts/);
});
