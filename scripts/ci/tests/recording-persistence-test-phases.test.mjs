import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeRecordingPersistencePhases,
  recordingPersistenceTests,
} from '../recording-persistence-test-phases.mjs';
import { selectFocusedIosTests } from '../ios-focused-selection.mjs';

function fixture(change = {}) {
  const calls = [];
  const deletedSourceId = '11111111-2222-4333-8444-555555555555';
  const seed = {
    processIdentifier: 10,
    result: {
      retainedSourceId: '11111111-2222-4333-8444-666666666666',
      deletedSourceId,
      retained: { source: 'actual receipt fixture' },
      memoryInvalidation: 'passed',
      deletionCommitted: true,
      ...change.seed,
    },
  };
  const restored = {
    processIdentifier: 11,
    result: { deletedSourceId, deletionAbsent: true, retainedCleaned: true },
    ...change.restored,
  };
  const step = (name, value) => {
    calls.push(name);
    if (calls.length === change.failAt) throw new Error('first failure');
    return value;
  };
  return {
    calls,
    operations: {
      reset: () => step('reset'),
      run: (id, baseline) => {
        if (id === recordingPersistenceTests[1]) assert.deepEqual(baseline, seed);
        return step(id, id === recordingPersistenceTests[0] ? seed : restored);
      },
    },
  };
}

test('recording persistence preserves the source receipt across exactly two processes without resetting between them', async () => {
  const value = fixture();
  await executeRecordingPersistencePhases(value.operations);
  assert.deepEqual(value.calls, ['reset', ...recordingPersistenceTests]);
});

test('recording phases stop at their first failure and reject missing, identical or incomplete source/process proof', async () => {
  for (const change of [
    ...[1, 2, 3].map((failAt) => ({ failAt })),
    { seed: { retainedSourceId: '11111111-2222-4333-8444-555555555555' } },
    { seed: { memoryInvalidation: 'failed' } },
    { seed: { deletionCommitted: false } },
    { restored: { processIdentifier: 10 } },
    { restored: { processIdentifier: null } },
    { restored: { result: { deletionAbsent: false } } },
  ]) {
    const value = fixture(change);
    await assert.rejects(executeRecordingPersistencePhases(value.operations));
    if (change.failAt) assert.equal(value.calls.length, change.failAt);
  }
});

test('recording persistence focus requires both phases and their exact driver', () => {
  const selected = selectFocusedIosTests(
    'ios/core',
    'scripts/ci/recording-persistence-test-phases.mjs',
    'group/recording-persistence',
  );
  assert.deepEqual(selected.identifiers, recordingPersistenceTests);
  assert.equal(selected.mode, 'recording-persistence');
  assert.throws(() =>
    selectFocusedIosTests('ios/core', 'unrelated', 'group/recording-persistence'),
  );
  for (const id of recordingPersistenceTests)
    assert.throws(() =>
      selectFocusedIosTests(
        'ios/core',
        'apps/mobile/ios/OrotIntegrationTests/RecordingPersistenceIntegrationTests.swift',
        id,
      ),
    );
});
