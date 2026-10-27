import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  OwnedProcessSupervisor,
  readProcessSnapshot,
} from '../ios-test-owned-process-supervisor.mjs';

const row = (pid, parent, group, state = 'S', identity = 'original') => ({
  pid,
  parent,
  group,
  state,
  identity,
});

test('tracks nested canonical groups, forwards root SIGINT and never signals zombies', () => {
  const root = row(10, 1, 10);
  let rows = [root, row(11, 10, 11), row(12, 11, 11), row(99, 1, 99)];
  const signals = [];
  const owner = new OwnedProcessSupervisor(root, {
    snapshot: () => rows,
    signal: (...args) => signals.push(args),
  });
  owner.interrupt();
  assert.deepEqual(signals, [[10, 'SIGINT']]);
  rows = [row(11, 1, 11, 'Z'), row(12, 1, 11), row(99, 1, 99)];
  owner.escalate('SIGTERM');
  assert.deepEqual(signals, [
    [10, 'SIGINT'],
    [12, 'SIGTERM'],
  ]);
  assert.equal(owner.cleanupReceipt().writersStopped, false);
  rows = [row(11, 1, 11, 'Z'), row(99, 1, 99)];
  assert.equal(owner.cleanupReceipt().writersStopped, true);
});

test('EPERM preserves ownership and PID reuse never signals unrelated processes', () => {
  const root = row(10, 1, 10);
  let rows = [root];
  const signals = [];
  const owner = new OwnedProcessSupervisor(root, {
    snapshot: () => rows,
    signal: (pid) => {
      signals.push(pid);
      throw Object.assign(new Error('Synthetic denied signal'), { code: 'EPERM' });
    },
  });
  owner.interrupt();
  rows = [row(10, 1, 10, 'S', 'reused')];
  owner.escalate('SIGKILL');
  assert.deepEqual(signals, [10]);
  assert.deepEqual(owner.cleanupReceipt(), {
    writersStopped: false,
    supervisionUncertain: true,
    livePIDs: [],
  });
});

test('unavailable snapshots fail closed before cleanup', () => {
  const owner = new OwnedProcessSupervisor(row(10, 1, 10), {
    snapshot: () => {
      throw new Error('Snapshot unavailable');
    },
  });
  assert.throws(() => owner.cleanupReceipt(), /Snapshot unavailable/);
});

test(
  'real nested group receives canonical root forwarding and writers stop before cleanup',
  { timeout: 10000 },
  async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
    const { spawn } = require('node:child_process');
    const nested = spawn(process.execPath, ['-e', "process.on('SIGINT', () => process.exit(0)); console.log('ready'); setInterval(() => {}, 1000)"], { detached: true });
    nested.stdout.once('data', () => console.log('ready'));
    process.on('SIGINT', () => nested.kill('SIGINT'));
    nested.once('exit', () => process.exit(0));
  `,
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let owner;
    const exited = once(child, 'exit');
    const watchdog = setTimeout(() => {
      if (owner) owner.escalate('SIGKILL');
      else child.kill('SIGKILL');
    }, 5000);
    try {
      await once(child.stdout, 'data');
      const root = readProcessSnapshot().find((item) => item.pid === child.pid);
      assert.ok(root, 'Owned root must be visible before control');
      owner = new OwnedProcessSupervisor(root);
      assert.ok(
        owner.observe().some((item) => item.parent === child.pid && item.group !== root.group),
      );
      owner.interrupt();
      const [code, signal] = await exited;
      assert.equal(code, 0);
      assert.equal(signal, null);
      assert.equal(owner.cleanupReceipt().writersStopped, true);
    } finally {
      clearTimeout(watchdog);
      if (owner && !owner.cleanupReceipt().writersStopped) owner.escalate('SIGKILL');
    }
  },
);
