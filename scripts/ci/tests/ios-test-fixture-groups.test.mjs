import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosFixtureGroups, selectIosFixtureGroup } from '../ios-test-fixture-groups.mjs';

test('all four hosted fixture groups partition the original 22 exact cases without duplication', () => {
  const original = iosTestInventory('fixtures');
  const groups = Object.keys(iosFixtureGroups).map((group) => iosTestInventory('fixtures', group));
  assert.deepEqual(
    groups.map((group) => group.length),
    [7, 5, 4, 6],
  );
  assert.equal(new Set(groups.flat()).size, original.length);
  assert.equal(original.length, 22);
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

test('the hosted matrix schedules every group and retains single-destination cleanup and existing budgets', () => {
  const workflow = readFileSync('.github/workflows/ios-test-validation.yml', 'utf8');
  const selected = [...workflow.matchAll(/- profile: fixtures\s+suite: ([a-z-]+)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(selected, Object.keys(iosFixtureGroups));
  assert.match(workflow, /OROT_IOS_TEST_SUITE: \$\{\{ matrix\.suite \}\}/);
  assert.match(workflow, /matrix\.profile == 'local-model' && 65 \|\| 45/);
  const runner = readFileSync('scripts/ci/run-ios-fixture-tests.mjs', 'utf8');
  assert.match(runner, /selected\.length \? selected : iosTestInventory\(profile, suite\)/);
  assert.match(runner, /resetIosTestFixtureContainer\(profile, owner, app\)/);
  assert.match(runner, /finally[\s\S]*removeIosTestFixtureContainer\(profile, owner\)/);
});
