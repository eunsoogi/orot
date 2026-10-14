import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

test('hosted Speech verifies actual assets before its first recognition without retrying a fixture', () => {
  const tasks = iosTestCohortTasks('speech');
  assert.deepEqual(
    tasks.map(({ suite }) => suite),
    ['preparation', 'native', 'ui'],
  );
  assert.deepEqual(tasks[0].identifiers, iosTestInventory('speech', 'preparation'));
  assert.equal(tasks[0].identifiers.length, 1);
  assert.ok(tasks[0].identifiers.every((id) => id.includes('/SpeechAssetPreparationTests/')));
  const runner = readFileSync('scripts/ci/run-ios-test-cohort.mjs', 'utf8');
  assert.match(runner, /OROT_IOS_TEST_SUITE: suite/);
  assert.match(runner, /run-ios-tests\.mjs/);
  assert.match(runner, /ios-test-results\.mjs/);
  const source = readFileSync('.github/actions/ios-test-cohort-run/action.yml', 'utf8');
  assert.ok(
    source.indexOf('Verify configuration, source and product integrity before boot') <
      source.indexOf('prepare-cohort'),
  );
  assert.match(source, /artifacts\/ios-cohort\/results/);
  assert.doesNotMatch(source, /continue-on-error|test-iterations/);
});
