import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohort, iosTestCohortTasks } from '../ios-test-cohorts.mjs';
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

test('one hosted Release cohort schedules every logical group and retains isolation and cumulative budgets', () => {
  const selected = iosTestCohortTasks('release').filter(({ profile }) => profile === 'fixtures');
  assert.deepEqual(
    selected.map(({ suite }) => suite),
    Object.keys(iosFixtureGroups),
  );
  assert.equal(iosTestCohort('release').minutes, 45 + 45 + 45 + 65);
  const workflow = readFileSync('.github/workflows/ios-test-validation.yml', 'utf8');
  assert.match(workflow, /cohort: release/);
  assert.doesNotMatch(workflow, /matrix:/);
  const cohortRunner = readFileSync('scripts/ci/run-ios-test-cohort.mjs', 'utf8');
  assert.match(cohortRunner, /OROT_IOS_TEST_SUITE: suite/);
  const runner = readFileSync('scripts/ci/run-ios-fixture-tests.mjs', 'utf8');
  assert.match(runner, /selected\.length \? selected : iosTestInventory\(profile, suite\)/);
  assert.match(runner, /resetIosTestFixtureContainer\(profile, owner, app\)/);
  assert.match(runner, /finally[\s\S]*removeIosTestFixtureContainer\(profile, owner\)/);
});
