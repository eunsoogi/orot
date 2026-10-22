import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestResourceSampler } from '../ios-test-resources.mjs';

test('periodic sampling can keep memory and swap while skipping the process query', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-resource-during-process-'));
  const sidecar = join(directory, 'resources.jsonl');
  const commands = [];
  let periodicSnapshotStarted;
  const periodicSample = new Promise((resolve) => (periodicSnapshotStarted = resolve));

  async function execute(program, args, { signal } = {}) {
    commands.push([program, args]);
    if (commands.length === 5) periodicSnapshotStarted();
    // If the periodic ps query runs, model a child that completes only when shutdown aborts it.
    if (program === 'ps' && commands.length === 6)
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ unavailable: 'sampling stopped' }), {
          once: true,
        });
      });
    return program + ' synthetic\n';
  }

  let stopSampling;
  try {
    stopSampling = await iosTestResourceSampler(sidecar, {
      intervalMs: 200,
      execute,
      skipDuringProcessSnapshot: true,
    });
    await periodicSample;
    await new Promise((resolve) => setImmediate(resolve));
    await stopSampling();

    const entries = readFileSync(sidecar, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      entries.map((entry) => entry.stage),
      ['before', 'during', 'after'],
    );
    assert.deepEqual(
      commands.map(([program]) => program),
      ['vm_stat', 'sysctl', 'ps', 'vm_stat', 'sysctl', 'vm_stat', 'sysctl', 'ps'],
    );
    assert.deepEqual(entries[1].observations, {
      memory: 'vm_stat synthetic\n',
      swap: 'sysctl synthetic\n',
      processes: { unavailable: 'periodic process snapshot skipped during boot or XCTest' },
    });
    assert.equal(entries[0].observations.processes, 'ps synthetic\n');
    assert.equal(entries[2].observations.processes, 'ps synthetic\n');
  } finally {
    if (stopSampling) await stopSampling();
    rmSync(directory, { recursive: true, force: true });
  }
});
