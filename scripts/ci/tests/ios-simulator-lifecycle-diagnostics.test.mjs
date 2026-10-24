import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startIosSimulatorLifecycleDiagnostics } from '../ios-simulator-lifecycle-diagnostics.mjs';

const source = {
  invocationId: '00000000-0000-4000-8000-000000000001',
  profile: 'core',
  tests: ['OrotUITests/LaunchTests/testLaunch'],
  sourceSha: 'abc123',
  runId: '42',
  attempt: '2',
};

async function stream(program, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-lifecycle-stream-'));
  const path = join(directory, 'lifecycle.log');
  let invocation;
  let output = '';
  let resolveOutput;
  let resolveClose;
  const outputReady = new Promise((resolve) => (resolveOutput = resolve));
  const closed = new Promise((resolve) => (resolveClose = resolve));
  const stop = await startIosSimulatorLifecycleDiagnostics('owned-udid', path, source, {
    ...options,
    spawnProcess: (command, args, settings) => {
      invocation = { command, args, settings };
      const child = spawn(process.execPath, ['-e', program], settings);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        resolveOutput();
      });
      child.once('close', resolveClose);
      return child;
    },
  });
  return {
    directory,
    path,
    stop,
    invocation: () => invocation,
    outputReady,
    output: () => output,
    closed,
  };
}

test('streams only owned Simulator lifecycle logs and writes an invocation-bound receipt', async () => {
  const value = await stream("process.stdout.write('launch event\\n');setInterval(()=>{},1000)");
  try {
    await value.outputReady;
    const record = await value.stop({ testExitCode: 65 });
    assert.equal(record.state, 'stopped');
    assert.equal(record.testExitCode, 65);
    assert.equal(record.source.invocationId, source.invocationId);
    assert.equal(record.source.udid, 'owned-udid');
    assert.match(readFileSync(value.path, 'utf8'), /launch event/);
    assert.match(readFileSync(value.path, 'utf8'), new RegExp(source.invocationId));
    assert.deepEqual(JSON.parse(readFileSync(value.path + '.json', 'utf8')), record);
    assert.deepEqual(value.invocation().args.slice(0, 5), [
      'simctl',
      'spawn',
      'owned-udid',
      'log',
      'stream',
    ]);
    assert.ok(!value.invocation().args.includes('--private'));
    assert.match(value.invocation().args.at(-1), /FrontBoard/);
    assert.doesNotMatch(value.invocation().args.at(-1), /health|clipboard|OROT_AUTH_DIAGNOSTIC/i);
    assert.equal(await value.stop({ testExitCode: 0 }), record);
  } finally {
    await value.stop();
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('caps storage and retains the newest lifecycle events', async () => {
  const value = await stream(
    "process.stdout.write('x'.repeat(512));setTimeout(()=>process.stdout.write('LATEST_LAUNCH_FAILURE'),20);setInterval(()=>{},1000)",
    { maxBytes: 64 },
  );
  try {
    await value.outputReady;
    while (!value.output().includes('LATEST_LAUNCH_FAILURE'))
      await new Promise((resolve) => setTimeout(resolve, 5));
    const record = await value.stop({ testExitCode: 65 });
    const retained = readFileSync(value.path, 'utf8');
    assert.equal(record.truncated, true);
    assert.equal(record.capturedBytes, 64);
    assert.ok(record.observedBytes > record.maxBytes);
    assert.match(retained, /LATEST_LAUNCH_FAILURE$/);
    assert.ok(Buffer.byteLength(retained) <= 64 + 512);
  } finally {
    await value.stop();
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('records no events without describing the launch as healthy', async () => {
  const value = await stream('setInterval(()=>{},1000)');
  try {
    const record = await value.stop({ testExitCode: 0 });
    assert.equal(record.dataState, 'no-events');
    assert.equal(record.source.invocationId, source.invocationId);
    assert.equal('healthy' in record, false);
  } finally {
    await value.stop();
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('records collector startup failure while retaining the original test exit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-lifecycle-unavailable-'));
  const path = join(directory, 'lifecycle.log');
  try {
    const stop = await startIosSimulatorLifecycleDiagnostics('owned-udid', path, source, {
      spawnProcess: () => {
        throw new Error('log stream unavailable');
      },
    });
    const record = await stop({ testExitCode: 65 });
    assert.equal(record.state, 'unavailable');
    assert.equal(record.testExitCode, 65);
    assert.equal(record.stopConfirmed, false);
    assert.match(record.error, /log stream unavailable/);
    assert.match(readFileSync(path, 'utf8'), /simulator_udid=owned-udid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stops only its own child and records forced termination', async () => {
  const value = await stream(
    "process.on('SIGTERM',()=>{});process.stdout.write('READY_TO_IGNORE_SIGTERM\\n');setInterval(()=>{},1000)",
    {
      stopGraceMs: 25,
    },
  );
  try {
    await value.outputReady;
    const record = await value.stop();
    assert.equal(record.stopConfirmed, true);
    assert.equal(record.forcedTermination, true);
    assert.equal(record.signal, 'SIGKILL');
  } finally {
    await value.stop();
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('preserves an existing log when writing the bounded collection fails', async () => {
  const value = await stream("process.stdout.write('event');setInterval(()=>{},1000)");
  try {
    await value.outputReady;
    writeFileSync(value.path, 'original evidence');
    const record = await value.stop({ testExitCode: 65 });
    assert.equal(record.state, 'unavailable');
    assert.equal(record.testExitCode, 65);
    assert.match(record.persistenceError, /EEXIST/);
    assert.equal(readFileSync(value.path, 'utf8'), 'original evidence');
    assert.equal(JSON.parse(readFileSync(value.path + '.json', 'utf8')).testExitCode, 65);
  } finally {
    await value.stop();
    rmSync(value.directory, { recursive: true, force: true });
  }
});
