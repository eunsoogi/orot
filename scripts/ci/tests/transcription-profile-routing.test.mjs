import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestConfig, iosTestBuildSpec } from '../ios-test-config.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

// Speech retains its pinned execution runtime and both authentic integration/UI boundaries while reusing compatible Release products.
test('Speech requires authentic recognition, one UI journey and a new-process readback plus separate asset preparation', () => {
  const spec = iosTestConfig('speech');
  assert.match(spec.runtime, /26-2/);
  assert.equal(spec.configuration, 'Release');
  assert.deepEqual(iosTestBuildSpec('speech'), iosTestBuildSpec('core'));
  const integration = iosTestInventory('speech', 'integration');
  const journey = iosTestInventory('speech', 'journey');
  assert.equal(integration.length, 6);
  assert.equal(journey.length, 2);
  assert.deepEqual([...integration, ...journey].sort(), iosTestInventory('speech').sort());
  assert.deepEqual(
    iosTestCohortTasks('speech').map((task) => task.suite),
    ['preparation', 'integration', 'journey'],
  );
});
