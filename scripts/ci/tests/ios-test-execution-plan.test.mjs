import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

test('independent feature suites have distinct jobs and preserve all registered observations', () => {
  const plan = iosTestExecutionPlan();
  assert.equal(plan.length, 17);
  assert.equal(new Set(plan.map((job) => job.name)).size, plan.length);
  assert.equal(plan.filter((job) => job.configuration === 'Debug').length, 4);
  const actual = plan.flatMap((job) =>
    iosTestCohortTasks(job.cohort).flatMap((task) => task.identifiers),
  );
  const original = ['release', 'debug', 'speech'].flatMap((name) =>
    iosTestCohortTasks(name).flatMap((task) => task.identifiers),
  );
  assert.equal(actual.length, 111);
  assert.deepEqual(actual.slice().sort(), original.slice().sort());
});

test('Questions partitions complete stateful cases into three independently scheduled jobs', () => {
  const jobs = iosTestExecutionPlan().filter((job) => job.cohort.startsWith('questions-'));
  assert.deepEqual(
    jobs.map((job) => job.cohort),
    ['questions-review', 'questions-conversation', 'questions-summary'],
  );
  const identifiers = jobs.flatMap((job) =>
    iosTestCohortTasks(job.cohort).flatMap((task) => task.identifiers),
  );
  assert.deepEqual(
    identifiers.slice().sort(),
    iosTestCohortTasks('questions')[0].identifiers.slice().sort(),
  );
  assert.equal(new Set(identifiers).size, 8);
  for (const job of jobs) {
    const tasks = iosTestCohortTasks(job.cohort);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].mode, 'fixture');
    // Relaunch, saved state, appearance and consent assertions stay inside their original XCTest methods.
    const classes = new Set(tasks[0].identifiers.map((identifier) => identifier.split('/')[1]));
    for (const name of classes)
      assert.equal(
        jobs.filter((candidate) =>
          iosTestCohortTasks(candidate.cohort)[0].identifiers.some(
            (identifier) => identifier.split('/')[1] === name,
          ),
        ).length,
        1,
      );
  }
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
