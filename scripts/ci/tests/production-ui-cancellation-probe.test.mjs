import assert from 'node:assert/strict';
import { connect } from 'node:net';
import test from 'node:test';
import { startProductionCancellationProbe } from '../production-ui-cancellation-probe.mjs';

test('accepts one fragmented nonce-bound runner frame without releasing its socket', async () => {
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const probe = await startProductionCancellationProbe({ onReady: resolveReady });
  const client = connect(probe.port, '127.0.0.1');
  await new Promise((resolve) => client.once('connect', resolve));
  client.write(`v1 ready ${probe.token} `);
  client.write('42\n');
  assert.deepEqual(await ready, { runnerPid: 42 });
  assert.equal(client.destroyed, false);
  await probe.close();
});

test('rejects an incorrect frame without announcing readiness', async () => {
  let resolveFailure;
  const failed = new Promise((resolve) => {
    resolveFailure = resolve;
  });
  let ready = false;
  const probe = await startProductionCancellationProbe({
    onReady: () => {
      ready = true;
    },
    onFailure: resolveFailure,
  });
  const client = connect(probe.port, '127.0.0.1');
  await new Promise((resolve) => client.once('connect', resolve));
  client.write('v1 ready wrong 42\n');
  assert.match(String(await failed), /probe/i);
  assert.equal(ready, false);
  client.destroy();
  await probe.close();
});

test('rejects a partial frame disconnect before readiness', async () => {
  let resolveFailure;
  const failed = new Promise((resolve) => {
    resolveFailure = resolve;
  });
  const probe = await startProductionCancellationProbe({
    onReady: () => assert.fail('unexpected ready'),
    onFailure: resolveFailure,
  });
  const client = connect(probe.port, '127.0.0.1');
  await new Promise((resolve) => client.once('connect', resolve));
  client.end('v1 ready');
  assert.match(String(await failed), /disconnected/i);
  await probe.close();
});

test('rejects a second frame after readiness', async () => {
  let resolveReady;
  let resolveFailure;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const failed = new Promise((resolve) => {
    resolveFailure = resolve;
  });
  const probe = await startProductionCancellationProbe({
    onReady: resolveReady,
    onFailure: resolveFailure,
  });
  const client = connect(probe.port, '127.0.0.1');
  await new Promise((resolve) => client.once('connect', resolve));
  client.write(`v1 ready ${probe.token} 42\n`);
  await ready;
  client.write('extra\n');
  assert.match(String(await failed), /frame/i);
  client.destroy();
  await probe.close();
});
