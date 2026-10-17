import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeFixtureIsolationPhases,
  fixtureIsolationTests,
} from '../fixture-isolation-test-phases.mjs';

function fixture(change = {}) {
  const calls = [];
  const token = '11111111-2222-4333-8444-555555555555';
  const clean = {
    paths: Object.fromEntries(
      ['database', 'wal', 'shm', 'recordings', 'deletions', 'exports'].map((key) => [key, false]),
    ),
    keys: Object.fromEntries(
      [
        'com.orot.mobile.database-encryption-key.v1',
        'com.orot.mobile.database-initialization.v1',
        'com.orot.mobile.provider-selection.v1',
        'com.orot.provider.openai.credentials',
        'com.orot.provider.openai.simulator-fixture',
      ].map((key) => [key, false]),
    ),
    preferences: {
      OrotFixturePollution: false,
      'com.orot.provider.openai.ext-agent-host-id': false,
    },
    pollutedPreferencesAbsent: true,
    keyFingerprint: null,
    microphoneUndetermined: true,
    speechUndetermined: true,
    foreignFile: true,
    foreignKey: true,
    foreignPreference: true,
    ...change.clean,
  };
  const reset = (processIdentifier) => ({
    token,
    action: 'reset',
    ok: true,
    processIdentifier,
    before: {
      preferences: Object.fromEntries(Object.keys(clean.preferences).map((key) => [key, true])),
      foreignPreference: true,
      ...change.before,
    },
    state: clean,
  });
  const seeded = { processIdentifier: 1, state: { keyFingerprint: 'old' }, reset: reset(1) };
  const verified = {
    processIdentifier: 2,
    reset: reset(change.verified?.processIdentifier ?? 2),
    result: { oldRecordAbsent: true },
    after: { keyFingerprint: 'new', foreignFile: true, foreignKey: true, foreignPreference: true },
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
      token,
      reset: () =>
        step('reset', { state: { foreignFile: true, foreignKey: true, ...change.clean } }),
      pollute: () => step('pollute', { state: { keyFingerprint: 'old', ...change.pollution } }),
      run: (id) => step(id, id === fixtureIsolationTests[0] ? seeded : verified),
    },
  };
}

test('each native process owns its startup reset; the host only seeds, pollutes and verifies once', async () => {
  const value = fixture();
  await executeFixtureIsolationPhases(value.operations);
  assert.deepEqual(value.calls, [fixtureIsolationTests[0], 'pollute', fixtureIsolationTests[1]]);
});

test('first failure, lost foreign state, same process, retained records or a reused key cannot satisfy isolation', async () => {
  for (const change of [
    ...[1, 2, 3].map((failAt) => ({ failAt })),
    { pollution: { keyFingerprint: 'replacement' } },
    { clean: { foreignKey: false } },
    { clean: { foreignPreference: false } },
    { clean: { pollutedPreferencesAbsent: false } },
    { before: { preferences: {} } },
    { before: { foreignPreference: false } },
    { verified: { reset: { token: 'foreign' } } },
    { verified: { processIdentifier: 1 }, error: /new process, clean data and renewed key/ },
    { verified: { result: { oldRecordAbsent: false } } },
    {
      verified: {
        after: {
          keyFingerprint: 'old',
          foreignFile: true,
          foreignKey: true,
          foreignPreference: true,
        },
      },
      error: /new process, clean data and renewed key/,
    },
  ]) {
    const value = fixture(change);
    await assert.rejects(executeFixtureIsolationPhases(value.operations), change.error);
    if (change.failAt) assert.equal(value.calls.length, change.failAt);
  }
});
