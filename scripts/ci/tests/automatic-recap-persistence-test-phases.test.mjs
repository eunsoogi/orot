import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  automaticRecapPersistenceTests,
  executeAutomaticRecapPersistencePhases,
  verifyAutomaticRecapReadback,
  verifyAutomaticRecapSeed,
} from '../automatic-recap-persistence-test-phases.mjs';

function seed() {
  const sourceId = '12345678-1234-1234-1234-123456789abc';
  return {
    sourceId,
    processIdentifier: 10,
    platform: 'ios',
    runtime: 'Hermes',
    recognition: 'synthetic',
    model: 'synthetic',
    speechCalls: 1,
    modelCalls: 1,
    result: {
      recordingSourceId: sourceId,
      questions: [{ status: 'evidence_found', answers: ['synthetic'] }],
    },
    records: [{ sourceMethod: 'ai_generated', revision: 1 }],
  };
}
function reopened(value) {
  return {
    sourceId: value.sourceId,
    processIdentifier: 11,
    platform: 'ios',
    runtime: 'Hermes',
    result: structuredClone(value.result),
    records: structuredClone(value.records),
  };
}

test('delivers the complete seed attachment to the distinct second phase', async () => {
  const first = seed();
  const calls = [];
  const result = await executeAutomaticRecapPersistencePhases(async (identifier, baseline) => {
    calls.push({ identifier, baseline });
    return baseline ? reopened(first) : first;
  });
  assert.deepEqual(
    calls.map((call) => call.identifier),
    automaticRecapPersistenceTests,
  );
  assert.equal(calls[1].baseline, first);
  assert.deepEqual(result, { seed: first, reopened: reopened(first) });
});

test('rejects missing or foreign seed data before scheduling readback', async () => {
  for (const change of [
    { modelCalls: 0 },
    { recognition: 'actual' },
    { sourceId: 'invalid' },
    { processIdentifier: 0 },
  ]) {
    const invalid = { ...seed(), ...change };
    assert.throws(() => verifyAutomaticRecapSeed(invalid));
    let calls = 0;
    await assert.rejects(
      executeAutomaticRecapPersistencePhases(async () => {
        calls++;
        return invalid;
      }),
    );
    assert.equal(calls, 1);
  }
});

test('rejects same-process readback and changes to the saved result or official record', () => {
  const first = seed();
  const sameProcess = { ...reopened(first), processIdentifier: first.processIdentifier };
  const changedResult = reopened(first);
  changedResult.result.questions[0].answers[0] = 'changed';
  const changedRecord = reopened(first);
  changedRecord.records[0].revision = 2;
  for (const value of [
    sameProcess,
    changedResult,
    changedRecord,
    { ...reopened(first), sourceId: 'other' },
  ])
    assert.throws(() => verifyAutomaticRecapReadback(first, value));
});
