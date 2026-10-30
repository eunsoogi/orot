import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cancellationPreflight, runOwned } from '../production-ui-cancellation.mjs';
import { executeProductionUi } from '../production-ui-execution.mjs';

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

test('cancellation before preflight readiness terminates its owned child and prevents install', async () => {
  const bus = new EventEmitter();
  const child = new EventEmitter();
  child.pid = 42;
  child.stdout = new EventEmitter();
  const sent = [];
  let installed = false;
  const execution = executeProductionUi({
    validate: async () => ({ runner: '/runner.app' }),
    preflight: () =>
      cancellationPreflight({
        spawnChild: () => child,
        signalBus: bus,
        signalGroup: (pid, signal) => sent.push([pid, signal]),
      }),
    installRunner: async () => {
      installed = true;
    },
    run: async () => {},
    verifyAfter: async () => {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  bus.emit('SIGTERM');
  child.emit('exit', null, 'SIGTERM');
  await assert.rejects(execution);
  assert.deepEqual(sent, [[-42, 'SIGTERM']]);
  assert.equal(installed, false);
  assert.equal(bus.listenerCount('SIGINT'), 0);
  assert.equal(bus.listenerCount('SIGTERM'), 0);
});

test('termination after readiness is forwarded before preflight exits', async () => {
  const bus = new EventEmitter();
  const child = new EventEmitter();
  child.pid = 42;
  child.stdout = new EventEmitter();
  const sent = [];
  const execution = cancellationPreflight({
    spawnChild: () => child,
    signalBus: bus,
    signalGroup: (pid, signal) => sent.push([pid, signal]),
  });
  child.stdout.emit('data', 'ready');
  bus.emit('SIGTERM');
  child.emit('exit', null, 'SIGTERM');
  await assert.rejects(execution);
  assert.deepEqual(sent, [
    [-42, 'SIGINT'],
    [-42, 'SIGTERM'],
  ]);
  assert.equal(bus.listenerCount('SIGINT'), 0);
  assert.equal(bus.listenerCount('SIGTERM'), 0);
});

test('failed group and fallback termination retain handlers until the spawned child exits', async () => {
  for (const fallback of [
    () => false,
    () => {
      throw new Error('kill failed');
    },
  ]) {
    const bus = new EventEmitter();
    const child = new EventEmitter();
    child.pid = 42;
    child.stdout = new EventEmitter();
    child.kill = fallback;
    const execution = cancellationPreflight({
      spawnChild: () => child,
      signalBus: bus,
      signalGroup: () => {
        throw new Error('group signal failed');
      },
    });
    const outcome = execution.then(
      () => 'passed',
      () => 'failed',
    );
    child.emit('spawn');
    bus.emit('SIGTERM');
    child.emit('error', new Error('termination failed'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(bus.listenerCount('SIGTERM'), 1);
    child.emit('exit', null, 'SIGTERM');
    assert.equal(await outcome, 'failed');
    assert.equal(bus.listenerCount('SIGTERM'), 0);
  }
});

test('signals queued before PID allocation are delivered and late readiness cannot restart preflight', async () => {
  const bus = new EventEmitter();
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  const sent = [];
  const execution = cancellationPreflight({
    spawnChild: () => child,
    signalBus: bus,
    signalGroup: (pid, signal) => sent.push([pid, signal]),
  });
  bus.emit('SIGINT');
  bus.emit('SIGTERM');
  child.pid = 42;
  child.emit('spawn');
  child.stdout.emit('data', 'ready');
  child.emit('exit', null, 'SIGTERM');
  await assert.rejects(execution);
  bus.emit('SIGTERM');
  assert.deepEqual(sent, [[-42, 'SIGTERM']]);
  assert.equal(bus.listenerCount('SIGTERM'), 0);
});

test('owned runner retains cancellation handlers after a post-spawn child error until close', async () => {
  const bus = new EventEmitter();
  const child = new EventEmitter();
  child.pid = 42;
  const execution = runOwned('test-child', [], {
    spawnChild: () => child,
    signalBus: bus,
    signalGroup: () => {
      throw new Error('signal failed');
    },
  });
  const outcome = execution.then(
    () => 'passed',
    () => 'failed',
  );
  child.emit('spawn');
  bus.emit('SIGINT');
  child.emit('error', new Error('child failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bus.listenerCount('SIGTERM'), 1);
  child.emit('close', null, 'SIGTERM');
  assert.equal(await outcome, 'failed');
  assert.equal(bus.listenerCount('SIGTERM'), 0);
});
