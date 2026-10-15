import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeFixtureIsolationPhases,
  fixtureIsolationTests,
} from '../fixture-isolation-test-phases.mjs';

function fixture(change = {}) {
  const calls = [];
  const seeded = { processIdentifier: 1, state: { keyFingerprint: 'old' } };
  const verified = {
    processIdentifier: 2,
    result: { oldRecordAbsent: true },
    after: { keyFingerprint: 'new', foreignFile: true, foreignKey: true },
    ...change.verified,
  };
  const step = (name, value) => {
    calls.push(name);
    if (change.failAt === calls.length) throw new Error('first failure');
    return value;
  };
  return {
    calls,
    operations: {
      reset: () =>
        step('reset', { state: { foreignFile: true, foreignKey: true, ...change.clean } }),
      pollute: () => step('pollute', { state: { keyFingerprint: 'old', ...change.pollution } }),
      run: (id) => step(id, id === fixtureIsolationTests[0] ? seeded : verified),
    },
  };
}

test('isolation proof seeds, contaminates, resets and reads actual storage in a new process exactly once', async () => {
  const value = fixture();
  await executeFixtureIsolationPhases(value.operations);
  assert.deepEqual(value.calls, [
    'reset',
    fixtureIsolationTests[0],
    'pollute',
    'reset',
    fixtureIsolationTests[1],
  ]);
});

test('first failure, lost foreign state, same process, retained records or a reused key cannot satisfy isolation', async () => {
  for (const change of [
    ...[1, 2, 3, 4, 5].map((failAt) => ({ failAt })),
    { pollution: { keyFingerprint: 'replacement' } },
    { clean: { foreignKey: false } },
    { verified: { processIdentifier: 1 } },
    { verified: { result: { oldRecordAbsent: false } } },
    { verified: { after: { keyFingerprint: 'old', foreignFile: true, foreignKey: true } } },
  ]) {
    const value = fixture(change);
    await assert.rejects(executeFixtureIsolationPhases(value.operations));
    if (change.failAt) assert.equal(value.calls.length, change.failAt);
  }
});
