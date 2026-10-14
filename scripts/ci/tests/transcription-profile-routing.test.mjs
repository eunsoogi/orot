import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestConfig, iosTestBuildSpec } from '../ios-test-config.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

// Speech retains its pinned execution runtime and both authentic integration/UI boundaries while reusing compatible Release products.
test('Speech requires all ten original methods plus separate asset preparation without a mock fallback', () => {
  const spec = iosTestConfig('speech');
  assert.match(spec.runtime, /26-2/);
  assert.equal(spec.configuration, 'Release');
  assert.deepEqual(iosTestBuildSpec('speech'), iosTestBuildSpec('core'));
  const native = iosTestInventory('speech', 'native');
  const ui = iosTestInventory('speech', 'ui');
  assert.equal(native.length, 6);
  assert.equal(ui.length, 4);
  assert.deepEqual([...native, ...ui].sort(), iosTestInventory('speech').sort());
  assert.deepEqual(
    iosTestCohortTasks('speech').map((task) => task.suite),
    ['preparation', 'native', 'ui'],
  );
});
