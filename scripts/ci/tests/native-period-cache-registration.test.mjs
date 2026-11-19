import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

const identifier =
  'OrotIntegrationTests/HermesDomainIntegrationTests/testNativePeriodStatementCachePreservesOwnerBoundaries';

// Registration proves selection only; the XCTest result must prove native behavior.
test('native cache owner fixture is scheduled once in core integration', () => {
  assert.equal(iosTestInventory('core').filter((value) => value === identifier).length, 1);
  const scheduled = iosTestCohortTasks('core-integration').flatMap((task) => task.identifiers);
  assert.equal(scheduled.filter((value) => value === identifier).length, 1);
});

test('native fixture explicitly excludes unobserved interruption and invalidation claims', () => {
  const source = readFileSync('apps/mobile/e2e/nativePeriodCacheOperation.ts', 'utf8');
  for (const field of ['cacheHitObserved', 'activeInterruptVerified', 'ownerInvalidateVerified'])
    assert.ok(source.includes(`${field}: false`));
  assert.ok(source.includes('test-period-cache-'));
  const dispatcher = readFileSync(
    'apps/mobile/e2e/healthContextPersistenceTestOperation.ts',
    'utf8',
  );
  assert.ok(dispatcher.includes("mode === 'native-statement-cache'"));
});
