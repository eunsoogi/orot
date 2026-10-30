import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cancellationPreflight, runOwned } from '../production-ui-cancellation.mjs';

test('the owned process group receives cancellation and reports termination', async () => {
  assert.deepEqual(await cancellationPreflight(), { signal: 'SIGINT', exitCode: 73 });
});

test('forwards a later termination when an owned child ignores interrupt', async () => {
  const bus = new EventEmitter();
  const child = new EventEmitter();
  child.pid = 42;
  const sent = [];
  const execution = runOwned('test-child', [], {
    spawnChild: () => child,
    signalBus: bus,
    signalGroup: (pid, signal) => sent.push([pid, signal]),
  });
  bus.emit('SIGINT');
  bus.emit('SIGTERM');
  child.emit('close', null, 'SIGTERM');
  const result = await execution;
  assert.deepEqual(sent, [
    [-42, 'SIGINT'],
    [-42, 'SIGTERM'],
  ]);
  assert.equal(result.cancellation, 'SIGINT');
});
