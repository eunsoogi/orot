import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestResourceSnapshot } from '../ios-test-resources.mjs';

test('host snapshots preserve raw PID/RSS, memory and swap evidence without substituting unavailable data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-resource-snapshot-'));
  const path = join(directory, 'samples.jsonl');
  const processes = 'PID PPID %CPU RSS COMM\n41 1 2.5 2048 modelmanagerd\n';
  const calls = [];
  try {
    iosTestResourceSnapshot(path, 'before-host-diagnosis', 0, (program, args, options) => {
      calls.push({ program, args, options });
      if (program === 'sysctl') throw new Error('swap observation unavailable');
      return program === 'ps' ? processes : 'Pages free: 321.\n';
    });
    const sample = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(sample.stage, 'before-host-diagnosis');
    assert.ok(Number.isFinite(Date.parse(sample.timestamp)));
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
