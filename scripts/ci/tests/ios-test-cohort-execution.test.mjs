import assert from 'node:assert/strict';
import test from 'node:test';
import { executeIosTestCohortTasks } from '../ios-test-cohort-execution.mjs';

const tasks = ['first', 'second', 'third'].map((profile) => ({
  profile,
  suite: 'all',
  identifiers: [profile + '/Class/testCase'],
}));
const observations = (task) =>
  task.identifiers.map((identifier) => ({ identifier, result: 'Passed', duration: 1 }));

test('cohort executor runs each exact task once and only reports success for complete observations', async () => {
  const calls = [];
  const result = await executeIosTestCohortTasks(tasks, async (task) => {
    calls.push(task.profile);
    return observations(task);
  });
  assert.deepEqual(calls, ['first', 'second', 'third']);
  assert.equal(result.passed, true);
  assert.equal(result.tasks.length, 3);
});

test('first failure remains terminal for its task without suppressing independent later observations', async () => {
  const calls = [];
  const result = await executeIosTestCohortTasks(tasks, async (task) => {
    calls.push(task.profile);
    if (task.profile === 'first') throw new Error('actual first-attempt Xcode exit 65');
    return observations(task);
  });
  assert.deepEqual(calls, ['first', 'second', 'third']);
  assert.equal(result.passed, false);
  assert.equal(result.tasks[0].status, 'failed');
  assert.match(result.tasks[0].error, /first-attempt Xcode exit 65/);
  assert.equal(result.tasks[1].status, 'passed');
});

test('missing, repeated, unexpected and failed observations cannot become cohort success', async () => {
  for (const invalid of [
    [],
    [observations(tasks[0])[0], observations(tasks[0])[0]],
    [{ identifier: 'other/Class/testCase', result: 'Passed' }],
    [{ identifier: tasks[0].identifiers[0], result: 'Failed' }],
  ]) {
    const result = await executeIosTestCohortTasks([tasks[0]], async () => invalid);
    assert.equal(result.passed, false);
    assert.equal(result.tasks[0].status, 'failed');
  }
});
