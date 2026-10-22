import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestResourceSampler } from '../ios-test-resources.mjs';

test('initial resource snapshot can omit only the process listing before XCTest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-resource-initial-process-'));
  const sidecar = join(root, 'resources.jsonl');
  const commands = [];

  async function execute(program, args) {
    commands.push([program, args]);
    return `${program} synthetic\n`;
  }

  try {
    const stopSampling = await iosTestResourceSampler(sidecar, {
      intervalMs: 60000,
      execute,
      skipInitialProcessSnapshot: true,
    });
    await stopSampling();

    const entries = readFileSync(sidecar, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      entries.map((entry) => entry.stage),
      ['before', 'after'],
    );
    assert.deepEqual(
      commands.map(([program]) => program),
      ['vm_stat', 'sysctl', 'vm_stat', 'sysctl', 'ps'],
    );
    assert.deepEqual(entries[0].observations, {
      memory: 'vm_stat synthetic\n',
      swap: 'sysctl synthetic\n',
      processes: { unavailable: 'process snapshot skipped before XCTest launch' },
    });
    assert.equal(entries[0].commandElapsedMs.processes, null);
    assert.equal(entries[1].observations.processes, 'ps synthetic\n');
    assert.ok(Number.isFinite(entries[1].commandElapsedMs.processes));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
