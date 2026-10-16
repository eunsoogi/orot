import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAuthDiagnosticLine } from '../ios-auth-diagnostic-record.mjs';

const sample = {
  event: 'start-return',
  attempt: '00000000-0000-4000-8000-000000000001',
  sequence: 3,
  uptimeSeconds: 42.5,
  applicationState: 0,
  sceneStates: [0],
  sessionRetained: true,
  continuationRetained: true,
  presentationWindowRetained: true,
  presentationWindowIsKey: true,
  started: true,
};
const line = (value) => 'timestamp Orot: OROT_AUTH_DIAGNOSTIC ' + JSON.stringify(value);

test('retains only the exact closed native diagnostic schema', () => {
  assert.deepEqual(parseAuthDiagnosticLine(line(sample)), { status: 'accepted', record: sample });
  const finish = { ...sample };
  delete finish.started;
  for (const outcome of [
    'task-cancelled',
    'system-cancelled',
    'error',
    'valid-app-return',
    'invalid-app-return',
  ]) {
    const value = { ...finish, event: 'finish-enter', outcome };
    assert.deepEqual(parseAuthDiagnosticLine(line(value)), { status: 'accepted', record: value });
  }
});

test('rejects an attempt array without coercing it to an allowed UUID', () => {
  assert.deepEqual(parseAuthDiagnosticLine(line({ ...sample, attempt: [sample.attempt] })), {
    status: 'rejected',
  });
});

test('rejects an attempt object without invoking a throwing primitive conversion', () => {
  assert.deepEqual(parseAuthDiagnosticLine(line({ ...sample, attempt: { toString: null } })), {
    status: 'rejected',
  });
});

test('ignores only the exact filter preamble observed in the native stream', () => {
  const preamble =
    'Filtering the log data using "process == "Orot" AND composedMessage BEGINSWITH "OROT_AUTH_DIAGNOSTIC ""';
  assert.deepEqual(parseAuthDiagnosticLine(preamble), { status: 'ignored' });
  assert.deepEqual(parseAuthDiagnosticLine(preamble + ' unexpected content'), {
    status: 'rejected',
  });
});

test('rejects unapproved fields, dynamic payloads and invalid primitive values without returning their content', () => {
  for (const change of [
    { event: 'auth code in event' },
    { attempt: 'account@example.invalid' },
    { url: 'https://example.invalid/?code=secret' },
    { authCode: 'secret' },
    { state: 'secret' },
    { token: 'secret' },
    { error: 'secret' },
    { started: 'true' },
    { started: undefined },
    { outcome: 'unexpected-extra-outcome' },
    { sessionRetained: 1 },
    { applicationState: 4 },
    { sceneStates: [99] },
    { sceneStates: Array(9).fill(0) },
    { sequence: 0 },
    { sequence: 65 },
    { sequence: 1.5 },
    { uptimeSeconds: -1 },
    { uptimeSeconds: null },
  ])
    assert.deepEqual(parseAuthDiagnosticLine(line({ ...sample, ...change })), {
      status: 'rejected',
    });
  assert.deepEqual(parseAuthDiagnosticLine('OROT_AUTH_DIAGNOSTIC {malformed secret'), {
    status: 'rejected',
  });
  assert.deepEqual(parseAuthDiagnosticLine('unrelated secret log'), { status: 'ignored' });
});
