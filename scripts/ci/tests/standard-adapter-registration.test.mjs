import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestImpactForPath } from '../ios-test-impact.mjs';

test('standard adapter bridge coverage is scheduled exactly once by the provider cohort', () => {
  const identifier =
    'OrotIntegrationTests/StandardAdapterIntegrationTests/testStandardAdaptersPreserveNativeDispatchSchemasToolsUsageAndCancellation';
  assert.ok(iosTestInventory('provider-data').includes(identifier));
  const scheduled = iosTestCohortTasks('provider').flatMap((task) => task.identifiers);
  assert.equal(scheduled.filter((value) => value === identifier).length, 1);
  for (const path of [
    'apps/mobile/ios/OrotIntegrationTests/StandardAdapterIntegrationTests.swift',
    'apps/mobile/e2e/standardAdaptersProbe.ts',
    'apps/mobile/e2e/standardAdaptersAppleProbe.ts',
    'apps/mobile/e2e/standardAdaptersOpenAIProbe.ts',
  ])
    assert.deepEqual(iosTestImpactForPath(path).cohorts, ['provider']);
});
