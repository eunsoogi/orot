import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { OwnedProcessSupervisor } from '../ios-test-owned-process-supervisor.mjs';
import {
  consumeReminderOwnedGroupPipe,
  createReminderOwnedGroupObserver,
} from '../ios-test-reminder-owned-groups.mjs';

const original = 'Tue Oct 27 13:18:45 2026';
const reused = 'Tue Oct 27 13:18:46 2026';
const row = (pid, group = pid, state = 'S', identity = original) => ({
  pid,
  parent: 1,
  group,
  state,
  identity,
});
const binding = {
  runID: '9ae30a38-2911-4555-b5a3-948a6ec879d9',
  sourceSHA: 'a'.repeat(40),
  selector: 'original-selector',
  udid: '9ae30a38-2911-4555-b5a3-948a6ec879d8',
};
const attempt = { phase: 'attempt', attemptSequence: 1 };
const spawned = { phase: 'spawned', attemptSequence: 1, ...row(11) };
function register(owner) {
  owner.registration(attempt);
  owner.registration(spawned);
  owner.closeRegistrations();
}

test('registered reparented writer stays owned after root exit and receives escalation', async () => {
  let rows = [row(10), row(11), row(99)];
  const signals = [];
  const owner = new OwnedProcessSupervisor(row(10), {
    snapshot: async () => rows,
    signal: (...args) => signals.push(args),
  });
  register(owner);
  await owner.observe();
  rows = [row(11), row(99)];
  assert.equal((await owner.cleanupReceipt()).writersStopped, false);
  await owner.escalate('SIGTERM');
  assert.deepEqual(signals, [[11, 'SIGTERM']]);
  rows = [row(99)];
  assert.equal((await owner.cleanupReceipt()).writersStopped, true);
});

test('unregistered escaping writer cannot become empty-set termination proof', async () => {
  const owner = new OwnedProcessSupervisor(row(10), { snapshot: async () => [row(12), row(99)] });
  owner.closeRegistrations();
  const receipt = await owner.cleanupReceipt();
  assert.equal(receipt.writersStopped, false);
  assert.equal(receipt.supervisionUncertain, true);
});

test('zombies are terminal, unrelated processes untouched, and EPERM never means absence', async () => {
  let rows = [row(10, 10, 'Z'), row(11, 11, 'Z'), row(99)];
  const signals = [];
  const owner = new OwnedProcessSupervisor(row(10), {
    snapshot: async () => rows,
    signal: (...args) => signals.push(args),
  });
  register(owner);
  await owner.escalate('SIGKILL');
  assert.deepEqual(signals, []);
  assert.equal((await owner.cleanupReceipt()).writersStopped, true);
  const denied = new OwnedProcessSupervisor(row(10), {
    snapshot: async () => rows,
    signal: () => {
      throw Object.assign(new Error('Denied'), { code: 'EPERM' });
    },
  });
  register(denied);
  rows = [row(10), row(11), row(99)];
  await denied.escalate('SIGTERM');
  rows = [row(99)];
  const deniedReceipt = await denied.cleanupReceipt();
  assert.equal(deniedReceipt.writersStopped, false);
  assert.equal(deniedReceipt.firstUncertainty.reason, 'process-signal-permission-denied');
  assert.equal(deniedReceipt.firstUncertainty.signal, 'SIGTERM');
});

test('PID/start identity reuse is never signalled, including between observation and signal', async () => {
  let calls = 0;
  const signals = [];
  const owner = new OwnedProcessSupervisor(row(10), {
    expectedGroups: 0,
    snapshot: async () => [row(10, 10, 'S', ++calls === 1 ? original : reused)],
    signal: (...args) => signals.push(args),
  });
  owner.closeRegistrations();
  await owner.escalate('SIGKILL');
  assert.deepEqual(signals, []);
  const receipt = await owner.cleanupReceipt();
  assert.equal(receipt.supervisionUncertain, true);
  assert.deepEqual(receipt.firstUncertainty, {
    reason: 'process-start-identity-changed-before-signal',
    expectedGroupCount: 0,
    attemptCount: 0,
    registeredGroupCount: 0,
    signal: 'SIGKILL',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)).firstUncertainty, receipt.firstUncertainty);
});

test('unavailable snapshots and unknown members after leader loss retain ownership', async () => {
  const unavailable = new OwnedProcessSupervisor(row(10), {
    snapshot: async () => {
      throw new Error('Unavailable');
    },
  });
  register(unavailable);
  assert.equal((await unavailable.cleanupReceipt()).writersStopped, false);
  const orphan = new OwnedProcessSupervisor(row(10), {
    snapshot: async () => [row(12, 11), row(99)],
  });
  register(orphan);
  const receipt = await orphan.cleanupReceipt();
  assert.equal(receipt.writersStopped, false);
  assert.equal(receipt.registeredWritersStopped, false);
});

test('pipe registrations require complete frames and every exact binding field', async () => {
  for (const invalid of [null, ...Object.keys(binding), 'partial', 'private', 'oversized']) {
    const owner = new OwnedProcessSupervisor(row(10), { snapshot: async () => [row(99)] });
    const stream = new PassThrough();
    const done = consumeReminderOwnedGroupPipe(stream, binding, owner);
    const context =
      invalid && Object.hasOwn(binding, invalid)
        ? { ...binding, [invalid]: 'mismatched' }
        : binding;
    let bytes =
      JSON.stringify({ ...context, ...attempt }) +
      '\n' +
      JSON.stringify({ ...context, ...spawned, parent: undefined, state: undefined }) +
      '\n';
    if (invalid === 'partial') bytes = bytes.trimEnd();
    if (invalid === 'private')
      bytes = JSON.stringify({ ...context, ...attempt, userInfo: 'private' }) + '\n';
    if (invalid === 'oversized') bytes = 'x'.repeat(8193);
    stream.end(bytes);
    await done;
    const receipt = await owner.cleanupReceipt();
    assert.equal(receipt.writersStopped, invalid === null);
    if (invalid === 'partial')
      assert.equal(receipt.firstUncertainty.reason, 'registration-frame-incomplete-at-close');
    if (invalid === 'private')
      assert.equal(receipt.firstUncertainty.reason, 'unsupported-registration-field');
  }
});

test('creation observer records attempt before spawn identity; incomplete identity produces failure', async () => {
  const frames = [];
  const observer = createReminderOwnedGroupObserver(binding, {
    write: (value) => frames.push(JSON.parse(value)),
    snapshot: async () => [row(11)],
  });
  await observer({ phase: 'attempt' });
  assert.equal(frames[0].phase, 'attempt');
  await observer({ phase: 'spawned', child: { pid: 11 } });
  assert.equal(frames[1].group, 11);
  const failed = [];
  const missing = createReminderOwnedGroupObserver(binding, {
    write: (value) => failed.push(JSON.parse(value)),
    snapshot: async () => [],
  });
  await missing({ phase: 'attempt' });
  await assert.rejects(() => missing({ phase: 'spawned', child: { pid: 11 } }), /incomplete/);
  assert.equal(failed[1].phase, 'failed');
});
