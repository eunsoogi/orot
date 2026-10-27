import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareRun,
  reminderDiagnosticTest,
  validateReminderDiagnosticTrace,
} from '../ios-test-reminder-diagnostic.mjs';

test('diagnostics require the original single selector and explicit flag', () => {
  assert.equal(prepareRun('fixtures', [reminderDiagnosticTest], undefined), null);
  assert.match(prepareRun('fixtures', [reminderDiagnosticTest], 'YES'), /^[a-f0-9-]{36}$/);
  for (const [profile, tests, flag] of [
    ['core', [reminderDiagnosticTest], 'YES'],
    ['fixtures', [], 'YES'],
    ['fixtures', [reminderDiagnosticTest, reminderDiagnosticTest], 'YES'],
    ['fixtures', ['OrotUITests/Other/test'], 'YES'],
    ['fixtures', [reminderDiagnosticTest], 'NO'],
  ])
    assert.throws(() => prepareRun(profile, tests, flag));
});

test('export validates complete fixed-schema events and rejects private fields or discontinuity', () => {
  const runID = '9ae30a38-2911-4555-b5a3-948a6ec879d9';
  const event = {
    runID,
    processID: 1,
    callSequence: 1,
    monotonicNanoseconds: '1',
    stage: 'diagnostic-ready',
  };
  const line = (value) =>
    JSON.stringify(
      Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
    ) + '\n';
  assert.deepEqual(validateReminderDiagnosticTrace(line(event), runID), {
    bytes: Buffer.byteLength(line(event)),
    events: 1,
  });
  for (const value of [
    { ...event, userInfo: 'private-visit' },
    { ...event, localizedDescription: 'private-health' },
    { ...event, callSequence: 2 },
    { ...event, stage: 'unknown' },
    {
      ...event,
      stage: 'center-add-reject',
      errorDomain: 'private-domain',
      errorCode: 1,
      ownErrorCase: 'other',
    },
  ])
    assert.throws(() => validateReminderDiagnosticTrace(line(value), runID));
  assert.throws(() => validateReminderDiagnosticTrace(line(event).trimEnd(), runID));
  assert.throws(() => validateReminderDiagnosticTrace(line(event), 'invalid'));
});
