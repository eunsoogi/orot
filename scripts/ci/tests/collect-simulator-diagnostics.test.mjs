import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const collectScript = fileURLToPath(new URL('../collect-simulator-diagnostics.sh', import.meta.url));

test('missing Detox test log is reported without a sed error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-diagnostics-'));
  const outputLog = join(directory, 'artifacts', 'simulator.log');
  try {
    const result = spawnSync('bash', [collectScript, join(directory, 'e2e-test.log'), outputLog], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(readFileSync(outputLog, 'utf8'), /Detox test log was not created/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
