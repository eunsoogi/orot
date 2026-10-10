import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardScript = fileURLToPath(new URL('../require-jest-summary.mjs', import.meta.url));

function runGuard(log, shard) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-shard-summary-'));
  const logPath = join(directory, 'jest.log');
  const outputPath = join(directory, 'github-output');
  try {
    writeFileSync(logPath, log);
    const result = spawnSync(process.execPath, [guardScript, logPath, 'e2e-release', outputPath], {
      encoding: 'utf8',
      env: { ...process.env, OROT_DETOX_RELEASE_SHARD: shard },
    });
    // A rejected shard must leave its per-job workflow outputs unpublished.
    return {
      ...result,
      githubOutput: existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '',
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('validates one selected Release shard before publishing its runner-local counts', () => {
  for (const [shard, tests] of [
    ['release-e2e.test.js', 3],
    ['release-e2e-safe-area.test.js', 4],
    ['release-e2e-data.test.js', 6],
  ]) {
    const result = runGuard(
      'Test Suites: 1 passed, 1 total\nTests: ' + tests + ' passed, ' + tests + ' total\n',
      shard,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.githubOutput,
      'e2e_profile=release\ne2e_test_cases=' + tests + '\ne2e_test_suites=1\n',
    );
  }

  const wrongCount = runGuard(
    'Test Suites: 1 passed, 1 total\nTests: 7 passed, 7 total\n',
    'release-e2e-data.test.js',
  );
  assert.notEqual(wrongCount.status, 0);
  assert.match(wrongCount.stderr, /expected 6 test cases, received 7/);
  assert.equal(wrongCount.githubOutput, '');

  const invalidShard = runGuard(
    'Test Suites: 1 passed, 1 total\nTests: 7 passed, 7 total\n',
    'release-e2e-typo.test.js',
  );
  assert.notEqual(invalidShard.status, 0);
  assert.equal(invalidShard.githubOutput, '');
});
