import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosFixtureGroups, selectIosFixtureGroup } from '../ios-test-fixture-groups.mjs';

test('all four hosted fixture groups partition the 21 UI cases after storage moves to native persistence', () => {
  const original = iosTestInventory('fixtures');
  const groups = Object.keys(iosFixtureGroups).map((group) => iosTestInventory('fixtures', group));
  assert.deepEqual(
    groups.map((group) => group.length),
    [6, 5, 4, 6],
  );
  assert.equal(new Set(groups.flat()).size, original.length);
  assert.equal(original.length, 21);
  assert.deepEqual(groups.flat().slice().sort(), original.slice().sort());
  assert.deepEqual(iosTestInventory('fixtures', 'all'), original);
});

test('unknown groups and unmapped fixture classes fail rather than narrowing the full gate', () => {
  assert.throws(() => iosTestInventory('fixtures', 'unknown'));
  assert.throws(() => iosTestInventory('core', 'navigation'));
  assert.throws(() => iosTestInventory('fixtures', 'ui'));
  assert.throws(() => selectIosFixtureGroup(['OrotUITests/UnknownTests/testCase'], 'all'));
  assert.throws(() => selectIosFixtureGroup([], 'navigation'));
});

test('independent hosted fixture jobs partition every logical group and retain per-case isolation', () => {
  const jobs = iosTestExecutionPlan().filter(({ profile }) => profile === 'fixtures');
  const selected = jobs.flatMap(({ cohort }) => {
    const tasks = iosTestCohortTasks(cohort);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].mode, 'fixture');
    return tasks;
  });
  assert.deepEqual(
    selected.map(({ suite }) => suite),
    Object.keys(iosFixtureGroups),
  );
  const workflow = readFileSync('.github/workflows/ios-release-tests.yml', 'utf8');
  for (const { cohort } of jobs) assert.ok(workflow.includes('      cohort: ' + cohort));
  assert.doesNotMatch(workflow, /matrix:/);
  const cohortRunner = readFileSync('scripts/ci/run-ios-test-cohort.mjs', 'utf8');
  assert.match(cohortRunner, /OROT_IOS_TEST_SUITE: suite/);
  const runner = readFileSync('scripts/ci/run-ios-fixture-tests.mjs', 'utf8');
  assert.match(runner, /selected\.length \? selected : iosTestInventory\(profile, suite\)/);
  assert.match(runner, /resetIosTestFixtureContainer\(profile, owner, app\)/);
  assert.match(runner, /finally[\s\S]*removeIosTestFixtureContainer\(profile, owner\)/);
});
