import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyIosCleanupInventory } from '../ios-test-cleanup-evidence.mjs';

test('cleanup evidence requires the owned UDID to be absent across every runtime', () => {
  const owner = { udid: 'owned' };
  assert.deepEqual(
    verifyIosCleanupInventory(owner, { devices: { first: [{ udid: 'other' }], second: [] } }),
    { udid: 'owned', absent: true },
  );
  assert.throws(
    () => verifyIosCleanupInventory(owner, { devices: { first: [], second: [{ udid: 'owned' }] } }),
    /remains/,
  );
  assert.throws(
    () => verifyIosCleanupInventory(owner, { devices: { first: null } }),
    /unknown shape/,
  );
  assert.throws(() => verifyIosCleanupInventory(owner, {}), /requires/);
});
