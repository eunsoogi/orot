import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeStatePersistencePhases,
  statePersistenceTests,
  statePersistencePhases,
} from '../state-persistence-test-phases.mjs';
import { selectFocusedIosTests } from '../ios-focused-selection.mjs';

const fixtureIdentifier = 'test-persistence-11111111-2222-4333-8444-555555555555';
const memoryIdentifier = 'test-memory-11111111-2222-4333-8444-666666666666';
function fixture(change = {}) {
  const calls = [];
  return {
    calls,
    operations: {
      fixtureIdentifier,
      memoryIdentifier,
      reset() {
        calls.push('reset');
      },
      run(identifier, phase, previous) {
        const index = statePersistenceTests.indexOf(identifier);
        calls.push(phase);
        assert.deepEqual(
          previous,
          Array.from({ length: index }, (_, i) => i + 10),
        );
        if (change.failAt === index) throw new Error('first failure');
        return {
          fixtureIdentifier,
          memoryIdentifier,
          phase,
          processIdentifier: index + 10,
          ...(index === 1 ? change.receipt : {}),
        };
      },
    },
  };
}
test('storage, memory and checkpoint share one fresh installation and three distinct processes', async () => {
  const value = fixture();
  const receipts = await executeStatePersistencePhases(value.operations);
  assert.deepEqual(value.calls, ['reset', ...statePersistencePhases]);
  assert.equal(receipts.length, 3);
});
test('state persistence stops before later work after its first failure or missing process/fixture proof', async () => {
  for (const change of [
    ...[0, 1, 2].map((failAt) => ({ failAt })),
    ...[
      { processIdentifier: 10 },
      { processIdentifier: null },
      { fixtureIdentifier: 'foreign' },
      { memoryIdentifier: 'foreign' },
      { phase: 'seed' },
    ].map((receipt) => ({ receipt })),
  ]) {
    const value = fixture(change);
    await assert.rejects(executeStatePersistencePhases(value.operations));
    assert.equal(value.calls.length, change.failAt === undefined ? 3 : change.failAt + 2);
  }
});
test('the observed shared UUID hash collision is rejected before installation', async () => {
  const value = fixture();
  value.operations.memoryIdentifier = fixtureIdentifier.replace(
    'test-persistence-',
    'test-memory-',
  );
  await assert.rejects(executeStatePersistencePhases(value.operations), /distinct UUID/);
  assert.deepEqual(value.calls, []);
});
test('state persistence selection requires all phases and their exact driver', () => {
  const selection = selectFocusedIosTests(
    'ios/core',
    'scripts/ci/state-persistence-test-phases.mjs',
    'group/state-persistence',
  );
  assert.deepEqual(selection.identifiers, statePersistenceTests);
  assert.equal(selection.prepareUi, false);
  assert.throws(() => selectFocusedIosTests('ios/core', 'unrelated', 'group/state-persistence'));
  for (const id of statePersistenceTests)
    assert.throws(() =>
      selectFocusedIosTests(
        'ios/core',
        'apps/mobile/ios/OrotIntegrationTests/StatePersistenceIntegrationTests.swift',
        id,
      ),
    );
});
