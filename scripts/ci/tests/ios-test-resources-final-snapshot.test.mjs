import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestResourceSampler } from '../ios-test-resources.mjs';

test('stop callback can skip the final process query after readiness confirmation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-resource-final-process-'));
  const sidecar = join(root, 'resources.jsonl');
  const commands = [];

  async function execute(program, args) {
    commands.push([program, args]);
    return `${program} synthetic\n`;
  }

  try {
    const stopSampling = await iosTestResourceSampler(sidecar, { intervalMs: 60000, execute });
    await stopSampling({ skipFinalProcessSnapshot: true });

    const entries = readFileSync(sidecar, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      entries.map((entry) => entry.stage),
      ['before', 'after'],
    );
    assert.deepEqual(
      commands.map(([program]) => program),
      ['vm_stat', 'sysctl', 'ps', 'vm_stat', 'sysctl'],
    );
    assert.equal(entries[0].observations.processes, 'ps synthetic\n');
    assert.deepEqual(entries[1].observations, {
      memory: 'vm_stat synthetic\n',
      swap: 'sysctl synthetic\n',
      processes: { unavailable: 'process snapshot skipped after readiness or test success' },
    });
    assert.ok(Number.isFinite(entries[1].commandElapsedMs.memory));
    assert.ok(Number.isFinite(entries[1].commandElapsedMs.swap));
    assert.equal(entries[1].commandElapsedMs.processes, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
