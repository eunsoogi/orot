import assert from 'node:assert/strict';
import test from 'node:test';
import { runProductionCancellationProbe } from '../production-ui-native-cancellation.mjs';

test('signals only the owned Xcode group after matching runner and app readiness', async () => {
  const sent = [];
  const live = [
    { pid: 10, group: 10, identity: 'xcode', state: 'S', command: '/xcodebuild' },
    {
      pid: 20,
      group: 20,
      identity: 'runner',
      state: 'S',
      command: '/new-runner/OrotUITests-Runner',
    },
    { pid: 30, group: 30, identity: 'app', state: 'S', command: '/new-app/Orot' },
  ];
  let callbacks;
  let marked = false;
  let closed = false;
  let count = 0;
  const result = await runProductionCancellationProbe(
    {
      udid: 'owned',
      runnerPath: '/runner',
      appPath: '/app',
      resolveInstalled: () => ({ runnerPath: '/new-runner', appPath: '/new-app' }),
      prepare: () => ['test'],
    },
    {
      startProbe: async (value) => {
        callbacks = value;
        return {
          port: 123,
          token: 'token',
          markCancellationRequested() {
            marked = true;
          },
          async close() {
            closed = true;
          },
        };
      },
      runChild: async (_command, _args, { onSpawn }) => {
        onSpawn({
          pid: 10,
          cancel(signal) {
            sent.push(signal);
          },
        });
        assert.deepEqual(sent, []);
        callbacks.onReady({ runnerPid: 20 });
        return { code: null, signal: 'SIGINT', cancellation: 'SIGINT' };
      },
      snapshot: () => (++count < 3 ? live : [live[2]]),
      matchesExecutable: (row, path) => row.command === path,
    },
  );
  assert.deepEqual(sent, ['SIGINT']);
  assert.equal(marked, true);
  assert.equal(closed, true);
  assert.equal(result.ownedAxRequest, 'completed-before-cancellation');
  assert.equal(result.appAlive, true);
});

test('a readiness frame with an unrelated runner cannot trigger SIGINT', async () => {
  let callbacks;
  const sent = [];
  const rows = [{ pid: 10, group: 10, identity: 'xcode', state: 'S', command: '/xcodebuild' }];
  await assert.rejects(
    runProductionCancellationProbe(
      {
        udid: 'owned',
        runnerPath: '/runner',
        appPath: '/app',
        prepare: () => ['test'],
      },
      {
        startProbe: async (value) => {
          callbacks = value;
          return { port: 123, token: 'token', markCancellationRequested() {}, async close() {} };
        },
        runChild: async (_command, _args, { onSpawn }) => {
          onSpawn({
            pid: 10,
            cancel(signal) {
              sent.push(signal);
            },
          });
          try {
            callbacks.onReady({ runnerPid: 20 });
          } catch (error) {
            callbacks.onFailure(error);
          }
          return { code: null, signal: 'SIGTERM', cancellation: 'SIGTERM' };
        },
        snapshot: () => rows,
        matchesExecutable: () => false,
      },
    ),
  );
  assert.deepEqual(sent, ['SIGTERM']);
});

test('reinstalled product verification failure prevents cancellation readiness', async () => {
  let callbacks;
  const sent = [];
  await assert.rejects(
    runProductionCancellationProbe(
      {
        runnerPath: '/runner',
        appPath: '/app',
        prepare: () => [],
        resolveInstalled: () => {
          throw new Error('product changed');
        },
      },
      {
        startProbe: async (value) => {
          callbacks = value;
          return { port: 123, token: 'token', markCancellationRequested() {}, async close() {} };
        },
        runChild: async (_command, _args, { onSpawn }) => {
          onSpawn({ pid: 10, cancel: (signal) => sent.push(signal) });
          try {
            callbacks.onReady({ runnerPid: 20 });
          } catch (error) {
            callbacks.onFailure(error);
          }
          return { code: null, signal: 'SIGTERM', cancellation: 'SIGTERM' };
        },
        snapshot: () => [{ pid: 10, group: 10, identity: 'xcode', state: 'S' }],
      },
    ),
  );
  assert.deepEqual(sent, ['SIGTERM']);
});

test('an Xcode crash after SIGINT cannot be reported as successful cancellation', async () => {
  let callbacks;
  let reads = 0;
  const rows = [
    { pid: 10, group: 10, identity: 'xcode', state: 'S', command: '/xcodebuild' },
    { pid: 20, group: 20, identity: 'runner', state: 'S', command: '/runner/OrotUITests-Runner' },
    { pid: 30, group: 30, identity: 'app', state: 'S', command: '/app/Orot' },
  ];
  await assert.rejects(
    runProductionCancellationProbe(
      { runnerPath: '/runner', appPath: '/app', prepare: () => [] },
      {
        startProbe: async (value) => {
          callbacks = value;
          return { port: 123, token: 'token', markCancellationRequested() {}, async close() {} };
        },
        runChild: async (_command, _args, { onSpawn }) => {
          onSpawn({ pid: 10, cancel() {} });
          callbacks.onReady({ runnerPid: 20 });
          return { code: null, signal: 'SIGABRT', cancellation: 'SIGINT' };
        },
        snapshot: () => (++reads < 3 ? rows : []),
        matchesExecutable: (row, path) => row.command === path,
      },
    ),
    /cleanup did not meet/,
  );
});
