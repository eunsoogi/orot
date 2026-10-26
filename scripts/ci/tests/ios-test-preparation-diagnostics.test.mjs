import assert from 'node:assert/strict';
import test from 'node:test';
import { iosPreparationInventory } from '../ios-test-preparation-diagnostics.mjs';

test('inventory projection preserves absent, malformed and unverified nonempty pair schemas as unknown', () => {
  for (const [snapshot, expected] of [
    [{}, { status: 'unknown-schema', entryCount: null }],
    [{ devicePairs: {} }, { status: 'unknown-schema', entryCount: null }],
    [{ pairs: null }, { status: 'unknown-schema', entryCount: null }],
    [{ pairs: [] }, { status: 'unknown-schema', entryCount: null }],
    [{ pairs: {} }, { status: 'observed-empty', entryCount: 0 }],
    [
      { pairs: { unverified: { phone: { name: 'private-name' } } } },
      { status: 'unknown-schema', entryCount: 1 },
    ],
  ]) {
    const projected = iosPreparationInventory({ udid: 'owned' }, snapshot, {}, {});
    assert.deepEqual(projected.pairs, expected);
    assert.doesNotMatch(JSON.stringify(projected), /private-name|phone|unverified/);
  }
});

test('inventory keeps only bounded owned identity and selected runtime fields', () => {
  const device = {
    name: 'private-name',
    dataPath: '/private-path',
    state: 'Shutdown',
    deviceTypeIdentifier: 'selected-type',
    isAvailable: true,
  };
  const runtime = {
    identifier: 'selected-runtime',
    buildversion: '24A434',
    isAvailable: true,
    root: '/private-runtime',
  };
  const projected = iosPreparationInventory(
    { udid: 'owned' },
    { pairs: {}, arbitrary: 'secret' },
    device,
    runtime,
  );
  assert.deepEqual(projected.device, {
    udid: 'owned',
    deviceTypeIdentifier: 'selected-type',
    state: 'Shutdown',
    isAvailable: true,
  });
  assert.deepEqual(projected.runtime, {
    identifier: 'selected-runtime',
    buildversion: '24A434',
    isAvailable: true,
  });
  assert.doesNotMatch(JSON.stringify(projected), /private|secret/);
  assert.equal(iosPreparationInventory({ udid: 'x'.repeat(161) }, {}, {}, {}).device.udid, null);
});
