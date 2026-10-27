import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encounterReviewPersistenceTests as identifiers,
  encounterReviewPersistencePhases as phases,
  executeEncounterReviewPersistencePhases,
  verifyEncounterReviewPhaseSelection,
} from '../encounter-review-persistence-test-phases.mjs';

const runId = '11111111-2222-4333-8444-555555555555';
const fixtureIdentifier = 'test-persistence-11111111-2222-4333-8444-666666666666';
const pending = {
  sourceId: fixtureIdentifier + ':review',
  threadId: 'original-thread',
  candidates: [{ id: 'medication' }, { id: 'plan' }],
};
function fixture(change) {
  const calls = [];
  return {
    calls,
    operations: {
      runId,
      fixtureIdentifier,
      reset() {
        calls.push('reset');
      },
      run(identifier, phase, previous) {
        const index = identifiers.indexOf(identifier);
        assert.deepEqual(
          previous,
          Array.from({ length: index }, (_, i) => i + 10),
        );
        calls.push(phase);
        let receipt = {
          runId,
          fixtureIdentifier,
          phase,
          processIdentifier: index + 10,
          ...(index === 0
            ? { status: 'pending', modelCalls: 1, recordCount: 0, pending }
            : index === 1
              ? {
                  status: 'saved',
                  modelCalls: 0,
                  restoredRecordCount: 0,
                  recordCount: 2,
                  restored: pending,
                }
              : {
                  status: 'saved',
                  modelCalls: 0,
                  records: [{}, {}],
                  evidence: [{}, {}, {}, {}],
                  cleanupVerified: true,
                }),
        };
        if (change) receipt = change(receipt, index);
        return receipt;
      },
    },
  };
}

test('independent review cohort resets once and preserves one run and fixture across three processes', async () => {
  const value = fixture();
  const receipts = await executeEncounterReviewPersistencePhases(value.operations);
  assert.deepEqual(value.calls, ['reset', ...phases]);
  assert.equal(new Set(receipts.map((receipt) => receipt.processIdentifier)).size, 3);
});

test('foreign identity, repeated PID, automatic writes/extraction and changed snapshot stop before another phase', async () => {
  const changes = [
    [0, { runId: 'other-run' }],
    [1, { fixtureIdentifier: 'other-fixture' }],
    [1, { processIdentifier: 10 }],
    [0, { phase: 'resume' }],
    [0, { processIdentifier: null }],
    [0, { recordCount: 1 }],
    [0, { modelCalls: 0 }],
    [1, { modelCalls: 1 }],
    [1, { restoredRecordCount: 1 }],
    [1, { restored: { ...pending, threadId: 'other-thread' } }],
    [2, { cleanupVerified: false }],
    [2, { records: [] }],
    [2, { evidence: [] }],
  ];
  for (const [failAt, change] of changes) {
    const value = fixture((receipt, index) =>
      index === failAt ? { ...receipt, ...change } : receipt,
    );
    await assert.rejects(executeEncounterReviewPersistencePhases(value.operations));
    assert.equal(value.calls.length, failAt + 2);
  }
});

test('a native phase cannot be selected outside the exact dedicated driver context', () => {
  for (const [index, identifier] of identifiers.entries()) {
    const env = {
      OROT_IOS_ENCOUNTER_REVIEW_PHASE: phases[index],
      TEST_RUNNER_OROT_ENCOUNTER_REVIEW_RUN_ID: runId,
      TEST_RUNNER_OROT_ENCOUNTER_REVIEW_FIXTURE: fixtureIdentifier,
      TEST_RUNNER_OROT_ENCOUNTER_REVIEW_PREVIOUS_PIDS: JSON.stringify(
        Array.from({ length: index }, (_, i) => i + 10),
      ),
    };
    verifyEncounterReviewPhaseSelection('core', [identifier], env);
    assert.throws(() => verifyEncounterReviewPhaseSelection('core', [identifier], {}));
    assert.throws(() => verifyEncounterReviewPhaseSelection('core', identifiers, env));
    assert.throws(() =>
      verifyEncounterReviewPhaseSelection('core', [identifiers[(index + 1) % 3]], env),
    );
    assert.throws(() => verifyEncounterReviewPhaseSelection('provider-data', [identifier], env));
  }
});
