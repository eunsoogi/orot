import assert from 'node:assert/strict';
import test from 'node:test';
import { executeIosFixtureSession } from '../ios-test-fixture-session.mjs';

const identifier =
  'OrotUITests/AppointmentReminderJourneyUITests/testLocalReplacementCancellationAndActualRunningAndColdNotificationTaps';
const command = [process.execPath, '-e', 'setTimeout(() => process.exit(0), 250)'];

// These bounded host children exercise creation and cancellation; no iOS acceptance is asserted.
test('optional observer records attempt before creation and sees the retained child handle', async () => {
  const phases = [];
  const result = await executeIosFixtureSession({
    identifiers: [identifier],
    command,
    handle() {},
    async onOwnedGroupSpawn(event) {
      phases.push(event.phase);
      if (event.phase === 'attempt') assert.equal(event.child, undefined);
      else assert.ok(event.child.pid > 0);
    },
  });
  assert.deepEqual(phases, ['attempt', 'spawned']);
  assert.equal(result.status, 0);
  assert.equal(result.failure, undefined);
});

test('observer failure cancels its actual created child and preserves failure', async () => {
  const result = await executeIosFixtureSession({
    identifiers: [identifier],
    command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    handle() {},
    async onOwnedGroupSpawn(event) {
      if (event.phase === 'spawned') throw new Error('Synthetic identity unavailable');
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.failure, /Synthetic identity unavailable/);
});

test('absent observer preserves the ordinary path, and failed attempt never creates a child', async () => {
  const ordinary = await executeIosFixtureSession({
    identifiers: [identifier],
    command,
    handle() {},
  });
  assert.equal(ordinary.status, 0);
  const phases = [];
  await assert.rejects(
    () =>
      executeIosFixtureSession({
        identifiers: [identifier],
        command,
        handle() {},
        async onOwnedGroupSpawn(event) {
          phases.push(event.phase);
          throw new Error('Synthetic pipe unavailable');
        },
      }),
    /Synthetic pipe unavailable/,
  );
  assert.deepEqual(phases, ['attempt']);
});
