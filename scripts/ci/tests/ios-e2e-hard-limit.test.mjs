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

for (const entry of ['e2e-test.yml', 'e2e-selected.yml']) {
  test(`${entry} gives every independently scheduled job a hard limit of at most 20 minutes`, () => {
    const jobs = leaves('.github/workflows/' + entry);
    assert.ok(jobs.length > 0);
    for (const job of jobs)
      assert.ok(
        Number.isFinite(job.minutes) && job.minutes > 0 && job.minutes <= 20,
        `${job.name} has an invalid hard limit: ${job.minutes}`,
      );
  });
}

test('the hosted execution plan never advertises a test allowance above 20 minutes', () => {
  for (const job of iosTestExecutionPlan()) assert.equal(job.minutes, 20, job.cohort);
});

for (const [suite, count] of [
  ['navigation', 3],
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
