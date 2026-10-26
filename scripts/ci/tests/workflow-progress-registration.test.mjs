import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestImpactForPath } from '../ios-test-impact.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

const identifier =
  'OrotIntegrationTests/HermesDomainIntegrationTests/testWorkflowProgressProjectsBufferedRuntimeEvents';

test('workflow progress Hermes coverage is scheduled once in core integration', () => {
  assert.equal(iosTestInventory('core').filter((value) => value === identifier).length, 1);
  const scheduled = iosTestCohortTasks('core-integration').flatMap((task) => task.identifiers);
  assert.equal(scheduled.filter((value) => value === identifier).length, 1);
});

test('workflow progress probe modules select only core integration', () => {
  for (const path of [
    'apps/mobile/e2e/workflowProgressProbe.ts',
    'apps/mobile/e2e/workflowProgressFixture.ts',
  ]) {
    assert.ok(existsSync(path), `${path} must remain in the native workflow probe`);
    assert.deepEqual(iosTestImpactForPath(path).cohorts, ['core-integration']);
  }
});
