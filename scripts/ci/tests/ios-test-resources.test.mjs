import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  executeResourceCommand,
  iosTestResourceSampler,
  iosTestResourceSnapshot,
} from '../ios-test-resources.mjs';

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

// Node reports AbortError before a killed child's close event; teardown must wait for both.
test('an aborted resource command waits for its child close before completing', async () => {
  const controller = new AbortController();
  const child = new EventEmitter();
  let closed = false;
  let completed = false;
  const run = (_program, _args, options, done) => {
    assert.equal('signal' in options, false);
    child.kill = (signal) => {
      assert.equal(signal, 'SIGKILL');
      done(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      return true;
    };
    return child;
  };
  const command = executeResourceCommand('diagnostic', [], { signal: controller.signal }, run).then(
    (result) => {
      completed = true;
      return result;
    },
  );
  child.once('close', () => (closed = true));

  try {
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed, false);
    child.emit('close', null, 'SIGKILL');
    const result = await command;
    assert.equal(closed, true);
    assert.match(result.unavailable, /AbortError/);
  } finally {
    if (!closed) child.emit('close', null, 'SIGKILL');
    await command;
  }
});

test('the default resource adapter reaps an aborted diagnostic child before resolving', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-resource-abort-'));
  const pidPath = join(root, 'child.pid');
  const controller = new AbortController();
  const childSource = [
    `process.on('SIGTERM', () => setTimeout(() => process.exit(0), 500));`,
    `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    'setInterval(() => {}, 1000);',
  ].join(' ');
  const command = executeResourceCommand(process.execPath, ['-e', childSource], {
    signal: controller.signal,
  });
  let childPid;

  try {
    const deadline = Date.now() + 2000;
    while (!existsSync(pidPath) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(existsSync(pidPath), 'diagnostic child must start before cancellation');
    childPid = Number(readFileSync(pidPath, 'utf8'));
    controller.abort();
    const result = await command;
    assert.equal(typeof result.unavailable, 'string');
    assert.equal(isProcessRunning(childPid), false, 'adapter must resolve only after child exit');
  } finally {
    if (!controller.signal.aborted) controller.abort();
    if (childPid && isProcessRunning(childPid)) process.kill(childPid, 'SIGKILL');
    await command;
    rmSync(root, { recursive: true, force: true });
  }
});

test('resource snapshots await child output without delaying a fast main child exit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-resource-snapshot-'));
  const sidecar = join(root, 'resources.jsonl');
  const pendingCommands = [];
  let snapshotComplete = false;

  function execute(program) {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `setTimeout(() => process.stdout.write(${JSON.stringify(`${program} synthetic\n`)}), 150)`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    const command = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (status, signal) =>
        status === 0 && !signal
          ? resolve(stdout)
          : reject(new Error(`diagnostic child failed: ${signal ?? status}`)),
      );
    });
    pendingCommands.push(command);
    return command;
  }

  try {
    const snapshot = Promise.resolve(iosTestResourceSnapshot(sidecar, 'before', 0, execute)).then(
      () => {
        snapshotComplete = true;
      },
    );
    const mainChild = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 20)'], {
      stdio: 'ignore',
    });
    const mainExit = new Promise((resolve, reject) => {
      mainChild.once('error', reject);
      mainChild.once('close', (status, signal) => resolve({ status, signal }));
    });

    assert.deepEqual(await mainExit, { status: 0, signal: null });
    assert.equal(snapshotComplete, false);
    await snapshot;

    const [entry] = readFileSync(sidecar, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(entry.observations, {
      memory: 'vm_stat synthetic\n',
      swap: 'sysctl synthetic\n',
      processes: 'ps synthetic\n',
    });
  } finally {
    await Promise.allSettled(pendingCommands);
    rmSync(root, { recursive: true, force: true });
  }
});

test('sampler serializes queries and stops its owned child before writing the after sample', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-resource-sampler-'));
  const sidecar = join(root, 'resources.jsonl');
  const pendingCommands = [];
  let commandStarts = 0;
  let activeChildren = 0;
  let maximumActiveChildren = 0;
  let resolveDuringStart;
  const duringStart = new Promise((resolve) => (resolveDuringStart = resolve));

  function execute(program, _args, { signal } = {}) {
    if (signal?.aborted) return Promise.resolve({ unavailable: 'sampling stopped' });
    commandStarts += 1;
    activeChildren += 1;
    maximumActiveChildren = Math.max(maximumActiveChildren, activeChildren);
    if (commandStarts === 4) resolveDuringStart();
    const delayMs = commandStarts === 4 ? 10000 : 10;
    const child = spawn(
      process.execPath,
      [
        '-e',
        `setTimeout(() => process.stdout.write(${JSON.stringify(`${program} synthetic\n`)}), ${delayMs})`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    const command = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (status, signalName) => {
        signal?.removeEventListener('abort', abort);
        resolve(status === 0 && !signalName ? stdout : { unavailable: 'sampling stopped' });
      });
    }).finally(() => {
      activeChildren -= 1;
    });
    pendingCommands.push(command);
    return command;
  }

  try {
    const stopSampling = await iosTestResourceSampler(sidecar, { intervalMs: 1, execute });
    await duringStart;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(commandStarts, 4);
    await stopSampling();

    assert.equal(maximumActiveChildren, 1);
    assert.equal(activeChildren, 0);
    const entries = readFileSync(sidecar, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      entries.map((entry) => entry.stage),
      ['before', 'during', 'after'],
    );
    assert.equal(entries[1].observations.memory.unavailable, 'sampling stopped');
    assert.equal(entries[1].observations.swap.unavailable, 'sampling stopped');
    assert.ok(Number.isFinite(entries[1].commandElapsedMs.memory));
    assert.equal(entries[1].commandElapsedMs.swap, null);
    assert.equal(entries[1].commandElapsedMs.processes, null);
    assert.equal(entries[2].observations.processes, 'ps synthetic\n');

    const stoppedCommandCount = commandStarts;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(commandStarts, stoppedCommandCount);
  } finally {
    await Promise.allSettled(pendingCommands);
    rmSync(root, { recursive: true, force: true });
  }
});
