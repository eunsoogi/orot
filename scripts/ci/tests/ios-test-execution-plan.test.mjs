import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

test('independent feature suites have distinct jobs and preserve the complete original observations', () => {
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
  assert.equal(actual.length, 82);
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
