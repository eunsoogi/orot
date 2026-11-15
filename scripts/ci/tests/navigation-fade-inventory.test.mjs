import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestInventory } from '../ios-test-inventory.mjs';

// Six new native boundaries increase the maintained counts; none replaces an older case.
test('core inventory owns every native fade lifecycle regression exactly once', () => {
  const expected = [
    'testPushKeepsGlassOpaqueAndRemovesSnapshot',
    'testPopKeepsGlassOpaqueAndRemovesSnapshot',
    'testCancelledPushRestoresSourceAndRemovesSnapshot',
    'testCancelledPopRestoresSourceAndRemovesSnapshot',
    'testBackgroundDropsTransientSnapshotBeforeCompletion',
    'testCaptureChangeDropsTransientSnapshotBeforeCompletion',
  ].map((name) => `OrotIntegrationTests/NavigationFadeIntegrationTests/${name}`);
  const actual = iosTestInventory('core', 'integration').filter((name) =>
    name.includes('/NavigationFadeIntegrationTests/'),
  );
  assert.deepEqual([...actual].sort(), [...expected].sort());
  assert.equal(new Set(actual).size, 6);
});
