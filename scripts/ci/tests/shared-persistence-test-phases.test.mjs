import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeSharedPersistencePhases,
  sharedPersistenceBatches,
} from '../shared-persistence-test-phases.mjs';
import { statePersistenceTests } from '../state-persistence-test-phases.mjs';
import { recordingPersistenceTests } from '../recording-persistence-test-phases.mjs';

const fixtureIdentifier = 'test-persistence-11111111-2222-4333-8444-555555555555';
const memoryIdentifier = 'test-memory-11111111-2222-4333-8444-666666666666';
function fixture(change = {}) {
  const calls = [];
  const seeded = {
    processIdentifier: 11,
    result: {
      retainedSourceId: '11111111-2222-4333-8444-777777777777',
      deletedSourceId: '11111111-2222-4333-8444-888888888888',
      retained: { source: 'saved source fields' },
      memoryInvalidation: 'passed',
      deletionCommitted: true,
    },
  };
  return {
    calls,
    options: {
      fixtureIdentifier,
      memoryIdentifier,
      reset() {
        calls.push('reset');
      },
      run(identifiers, phase, previousPids, baseline) {
        const index = ['seed', 'resume', 'absence'].indexOf(phase);
        calls.push(phase);
        assert.deepEqual(identifiers, sharedPersistenceBatches[index]);
        assert.deepEqual(
          previousPids,
          Array.from({ length: index }, (_, i) => 10 + i),
        );
        if (index === 2) assert.deepEqual(baseline, seeded);
        else assert.equal(baseline, undefined);
        if (change.failAt === index) throw new Error('first phase failure');
        const value = {
          state: { fixtureIdentifier, memoryIdentifier, phase, processIdentifier: 10 + index },
          ...(index > 0
            ? {
                recording:
                  index === 1
                    ? seeded
                    : {
                        processIdentifier: 12,
                        result: {
                          deletedSourceId: seeded.result.deletedSourceId,
                          deletionAbsent: true,
                          retainedCleaned: true,
                        },
                      },
              }
            : {}),
        };
        if (index === (change.phase ?? 1)) change.alter?.(value);
        return value;
      },
    },
  };
}

test('five original persistence oracles share exactly three real processes with the fresh storage seed alone', async () => {
  assert.deepEqual(sharedPersistenceBatches[0], [statePersistenceTests[0]]);
  assert.deepEqual(
    sharedPersistenceBatches.flat().sort(),
    [...statePersistenceTests, ...recordingPersistenceTests].sort(),
  );
  const value = fixture();
  const result = await executeSharedPersistencePhases(value.options);
  assert.deepEqual(value.calls, ['reset', 'seed', 'resume', 'absence']);
  assert.deepEqual(
    result.state.map((receipt) => receipt.processIdentifier),
    [10, 11, 12],
  );
  assert.equal(result.recording.seeded.processIdentifier, 11);
  assert.equal(result.recording.restored.processIdentifier, 12);
});

test('sharing rejects missing or mismatched domain receipts, reused processes and original oracle failures before a later batch', async () => {
  for (const change of [
    ...[0, 1, 2].map((failAt) => ({ failAt })),
    {
      alter: (value) => {
        delete value.recording;
      },
    },
    {
      alter: (value) => {
        value.recording.processIdentifier = 99;
      },
    },
    {
      alter: (value) => {
        value.state.processIdentifier = value.recording.processIdentifier = 10;
      },
    },
    {
      alter: (value) => {
        value.recording.result.memoryInvalidation = 'failed';
      },
    },
    {
      alter: (value) => {
        value.state.fixtureIdentifier = 'foreign';
      },
    },
    {
      phase: 2,
      alter: (value) => {
        value.recording.result.deletionAbsent = false;
      },
    },
    {
      phase: 2,
      alter: (value) => {
        value.recording.result.deletedSourceId = 'foreign';
      },
    },
    {
      phase: 2,
      alter: (value) => {
        value.state.processIdentifier = value.recording.processIdentifier = 11;
      },
    },
  ]) {
    const value = fixture(change);
    await assert.rejects(executeSharedPersistencePhases(value.options));
    assert.equal(value.calls.length, (change.failAt ?? change.phase ?? 1) + 2);
  }
});
