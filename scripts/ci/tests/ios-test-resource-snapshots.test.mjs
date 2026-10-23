import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestResourceSnapshot } from '../ios-test-resources.mjs';

test('host snapshots preserve raw PID/RSS, memory and swap evidence without substituting unavailable data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-resource-snapshot-'));
  const path = join(directory, 'samples.jsonl');
  const processes = 'PID PPID %CPU RSS COMM\n41 1 2.5 2048 modelmanagerd\n';
  const calls = [];
  try {
    // Wait for the asynchronous diagnostic children and sidecar write before reading the snapshot.
    await iosTestResourceSnapshot(
      path,
      'before-host-diagnosis',
      0,
      async (program, args, options) => {
        calls.push({ program, args, options });
        // A bounded delay proves elapsed fields track an observation even when its result is unavailable.
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (program === 'sysctl') throw new Error('swap observation unavailable');
        return program === 'ps' ? processes : 'Pages free: 321.\n';
      },
    );
    const sample = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(sample.stage, 'before-host-diagnosis');
    assert.ok(Number.isFinite(Date.parse(sample.timestamp)));
    assert.ok(Number.isFinite(Date.parse(sample.completedAt)));
    assert.ok(Date.parse(sample.completedAt) >= Date.parse(sample.timestamp));
    assert.ok(Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0);
    assert.deepEqual(Object.keys(sample.commandElapsedMs), ['memory', 'swap', 'processes']);
    assert.ok(
      Object.values(sample.commandElapsedMs).every(
        (elapsedMs) => Number.isFinite(elapsedMs) && elapsedMs >= 0,
      ),
    );
    assert.ok(sample.commandElapsedMs.memory >= 5);
    assert.ok(sample.commandElapsedMs.swap >= 5);
    assert.ok(sample.commandElapsedMs.processes >= 5);
    const commandElapsedTotal = Object.values(sample.commandElapsedMs).reduce(
      (sum, elapsedMs) => sum + elapsedMs,
      0,
    );
    assert.ok(sample.elapsedMs + 0.01 >= commandElapsedTotal);
    assert.equal(sample.observations.processes, processes);
    assert.equal(sample.observations.memory, 'Pages free: 321.\n');
    assert.match(sample.observations.swap.unavailable, /swap observation unavailable/);
    const ps = calls.find((call) => call.program === 'ps');
    assert.deepEqual(ps.args, ['-axo', 'pid,ppid,%cpu,rss,comm']);
    assert.ok(calls.every((call) => call.options.timeout === 10000));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
