import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestResourceSampler } from '../ios-test-resources.mjs';

test('periodic snapshots can omit only the process query while retaining boundary snapshots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-resource-during-process-'));
  const sidecar = join(root, 'resources.jsonl');
  const commands = [];
  let resolvePeriodicSample;
  const periodicSample = new Promise((resolve) => (resolvePeriodicSample = resolve));

  async function execute(program, args, { signal } = {}) {
    const commandIndex = commands.length + 1;
    commands.push([program, args]);
    if (commandIndex === 5) resolvePeriodicSample();
    // Without the periodic skip, model the `ps` child that stalls until sampler shutdown.
    if (program === 'ps' && commandIndex === 6)
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ unavailable: 'sampling stopped' }), {
          once: true,
        });
      });
    return `${program} synthetic\n`;
  }

  try {
    const stopSampling = await iosTestResourceSampler(sidecar, {
      intervalMs: 100,
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
      processes: {
        unavailable: 'periodic process snapshot skipped to avoid blocking sampler shutdown',
      },
    });
    assert.ok(Number.isFinite(entries[1].commandElapsedMs.memory));
    assert.ok(Number.isFinite(entries[1].commandElapsedMs.swap));
    assert.equal(entries[1].commandElapsedMs.processes, null);
    assert.equal(entries[0].observations.processes, 'ps synthetic\n');
    assert.equal(entries[2].observations.processes, 'ps synthetic\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
