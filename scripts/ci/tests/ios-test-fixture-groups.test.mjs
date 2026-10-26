import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosFixtureGroups, selectIosFixtureGroup } from '../ios-test-fixture-groups.mjs';

test('all four hosted fixture groups partition all maintained UI cases including appearance and saved-summary journeys', () => {
  const original = iosTestInventory('fixtures');
  const groups = Object.keys(iosFixtureGroups).map((group) => iosTestInventory('fixtures', group));
  assert.deepEqual(
    groups.map((group) => group.length),
    [8, 7, 8, 8],
  );
  assert.equal(new Set(groups.flat()).size, original.length);
  assert.equal(original.length, 31);
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
  assert.deepEqual([...new Set(selected.map(({ suite }) => suite))], Object.keys(iosFixtureGroups));
  assert.deepEqual(
    selected.flatMap(({ identifiers }) => identifiers).sort(),
    iosTestInventory('fixtures').sort(),
  );
  const workflow = [
    'ios-release-tests.yml',
    'ios-question-tests.yml',
    'ios-navigation-tests.yml',
    'ios-calendar-tests.yml',
    'ios-recording-tests.yml',
  ]
    .map((name) => readFileSync('.github/workflows/' + name, 'utf8'))
    .join('\n');
  for (const { cohort } of jobs) assert.ok(workflow.includes('      cohort: ' + cohort));
  assert.doesNotMatch(workflow, /matrix:/);
  const cohortRunner = readFileSync('scripts/ci/run-ios-test-cohort.mjs', 'utf8');
  assert.match(cohortRunner, /OROT_IOS_TEST_SUITE: suite/);
  assert.match(
    cohortRunner,
    /run-ios-fixture-tests\.mjs',[\s\S]*?\[task\.profile, runFile, ownerFile, results, \.\.\.task\.identifiers\]/,
  );
  const runner = readFileSync('scripts/ci/run-ios-fixture-tests.mjs', 'utf8');
  assert.match(runner, /selected\.length \? selected : iosTestInventory\(profile, suite\)/);
  assert.match(runner, /resetIosTestFixtureContainer\(profile, owner, app\)/);
  assert.match(
    runner,
    /mode === 'fresh-install'[\s\S]*removeIosTestFixtureContainer\(profile, owner\)/,
  );
});
