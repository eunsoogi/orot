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
  assert.equal(args[args.indexOf('--start') + 1], '2026-10-24 04:57:30+0000');
  assert.equal(args[args.indexOf('--end') + 1], '2026-10-24 04:58:30+0000');
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

test('native empty ndjson completion metadata is a valid empty result', () => {
  const result = collectBackupHostLifecycle({
    udid,
    observedAt,
    runCommand() {
      return '{"count":0,"finished":1}\n';
    },
  });
  assert.equal(result.status, 'empty');
  assert.deepEqual(result.events, []);
  assert.equal(result.start, '2026-10-24 04:57:30+0000');
  assert.equal(result.end, '2026-10-24 04:58:30+0000');
});

test('native event ndjson and completion metadata retain the CoreSimulator process identity', () => {
  const result = collectBackupHostLifecycle({
    udid,
    observedAt,
    runCommand() {
      return [
        JSON.stringify({
          timestamp: observedAt,
          processImagePath:
            '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/CoreSimulatorService',
          eventMessage: `Shutdown ${udid}`,
        }),
        JSON.stringify({ count: 1, finished: 1 }),
      ].join('\n');
    },
  });
  assert.equal(result.status, 'captured');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].process, 'CoreSimulatorService');
  assert.equal(JSON.stringify(result).includes('processImagePath'), false);
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
