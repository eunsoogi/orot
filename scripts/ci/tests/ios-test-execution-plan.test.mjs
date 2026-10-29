import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('core UI navigation and recording evidence have separate jobs without splitting original methods', () => {
  const cohorts = ['core-ui', 'health-review-ui', 'recording-evidence'];
  const jobs = iosTestExecutionPlan().filter((job) => cohorts.includes(job.cohort));
  assert.deepEqual(
    jobs.map((job) => job.cohort),
    cohorts,
  );
  const tasks = jobs.map((job) => {
    const tasks = iosTestCohortTasks(job.cohort);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].suite, 'ui');
    assert.equal(tasks[0].mode, 'plain');
    assert.equal(job.minutes, 20);
    return tasks[0];
  });
  const actual = tasks.flatMap((task) => task.identifiers);
  assert.equal(actual.length, 17);
  assert.equal(new Set(actual).size, 17);
  assert.deepEqual(actual.slice().sort(), iosTestInventory('core', 'ui').slice().sort());
  assert.deepEqual(
    tasks.map((task) => task.identifiers.length),
    [4, 7, 6],
  );
  assert.deepEqual(
    new Set(tasks[2].identifiers.map((identifier) => identifier.split('/')[1])),
    new Set(['RecordingExportUITests', 'TranscriptEvidenceUITests', 'EncounterReviewUITests']),
  );
});

test('independent feature suites have distinct jobs and preserve all registered observations', () => {
  const plan = iosTestExecutionPlan();
  assert.equal(plan.length, 29);
  assert.equal(new Set(plan.map((job) => job.name)).size, plan.length);
  assert.equal(plan.filter((job) => job.configuration === 'Debug').length, 5);
  const actual = plan.flatMap((job) =>
    iosTestCohortTasks(job.cohort).flatMap((task) => task.identifiers),
  );
  const original = ['release', 'debug', 'speech'].flatMap((name) =>
    iosTestCohortTasks(name).flatMap((task) => task.identifiers),
  );
  // Debug shares the three import journeys with Release, while the full Release graph schedules each case once.
  const uniqueOriginal = [...new Set(original)];
  assert.equal(original.length, 202);
  assert.equal(uniqueOriginal.length, 199);
  assert.equal(actual.length, uniqueOriginal.length);
  assert.equal(new Set(actual).size, actual.length);
  assert.deepEqual(actual.slice().sort(), uniqueOriginal.slice().sort());
});

test('Questions partitions complete stateful cases into five independently scheduled jobs', () => {
  const jobs = iosTestExecutionPlan().filter((job) => job.cohort.startsWith('questions-'));
  assert.deepEqual(
    jobs.map((job) => job.cohort),
    [
      'questions-review',
      'questions-conversation',
      'questions-accessibility',
      'questions-summary',
      'questions-literature',
    ],
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
    // Classes may span jobs, but each original method retains its full reset and cleanup boundary.
    assert.equal(job.minutes, 20);
    assert.equal(tasks[0].suite, 'questions');
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
  const selected = iosTestExecutionPlan([
    'backup',
    'recordings-controls',
    'recordings-review',
    'recordings-playback',
  ]);
  const actual = selected.flatMap((job) =>
    iosTestCohortTasks(job.cohort).flatMap((task) => task.identifiers),
  );
  const expected = ['backup', 'recordings'].flatMap((cohort) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  );

  assert.deepEqual(
    selected.map((job) => job.cohort),
    ['backup', 'recordings-controls', 'recordings-review', 'recordings-playback'],
  );
  assert.deepEqual(actual.slice().sort(), expected.slice().sort());
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
