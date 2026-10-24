import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBackupHostLifecycle } from '../ios-test-backup-host-lifecycle.mjs';

const udid = '11111111-2222-4333-8444-555555555555';
const observedAt = '2026-10-24T04:58:30.945Z';

test('host collection is bounded and keeps only CoreSimulator events for the owned UDID', () => {
  const foreign = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const records = [
    { timestamp: observedAt, process: 'CoreSimulatorService', eventMessage: `Shutdown ${udid}` },
    { timestamp: observedAt, process: 'CoreSimulatorService', eventMessage: `Shutdown ${foreign}` },
    { timestamp: observedAt, process: 'other-service', eventMessage: `Shutdown ${udid}` },
  ];
  let invocation;
  const result = collectBackupHostLifecycle({
    udid,
    observedAt,
    runCommand(...args) {
      invocation = args;
      return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    },
  });
  const [command, args, options] = invocation;
  assert.equal(command, '/usr/bin/log');
  assert.ok(args.includes('--start'));
  assert.ok(args.includes('--end'));
  assert.ok(args.includes('--predicate'));
  assert.ok(args.includes('--info'));
  assert.equal(args.includes('--private'), false);
  assert.equal(options.timeout, 3000);
  assert.ok(options.maxBuffer <= 262144);
  assert.equal(result.status, 'captured');
  assert.equal(result.events.length, 1);
  assert.match(result.events[0].eventMessage, new RegExp(udid));
  assert.equal(JSON.stringify(result).includes(foreign), false);
});

test('host-log timeout is unavailable and command output is omitted', () => {
  const result = collectBackupHostLifecycle({
    udid,
    observedAt,
    runCommand() {
      const error = new Error('sensitive command output');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'timeout');
  assert.equal(result.commandOutcome.errorCode, 'ETIMEDOUT');
  assert.equal(JSON.stringify(result).includes('sensitive command output'), false);
});
