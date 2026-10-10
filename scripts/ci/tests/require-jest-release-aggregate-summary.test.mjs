import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardScript = fileURLToPath(new URL('../require-jest-summary.mjs', import.meta.url));

function runGuard(log, suiteName, emitGithubOutputs = false, extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-jest-summary-'));
  const logPath = join(directory, 'jest.log');
  const outputPath = join(directory, 'github-output');
  try {
    writeFileSync(logPath, log);
    const result = spawnSync(
      process.execPath,
      [guardScript, logPath, suiteName, ...(emitGithubOutputs ? [outputPath] : [])],
      { encoding: 'utf8', env: { ...process.env, ...extraEnv } },
    );
    return {
      ...result,
      githubOutput:
        emitGithubOutputs && existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '',
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const shard = (name, tests) =>
  [
    `DETOX_RELEASE_SHARD_SUMMARY_START shard=${name}`,
    'Test Suites: 1 passed, 1 total',
    `Tests: ${tests} passed, ${tests} total`,
    `DETOX_RELEASE_SHARD_SUMMARY_END shard=${name}`,
  ].join('\n');

test('validates every Release shard before publishing the profile total', () => {
  const complete = [shard('release-e2e.test.js', 7), shard('release-e2e-data.test.js', 6)].join(
    '\n',
  );
  const result = runGuard(complete, 'e2e-release', true, {
    OROT_DETOX_RELEASE_SHARDING: 'true',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /13\/13 tests passed across 2 suites in 2 Jest runs/);
  assert.equal(result.githubOutput, 'e2e_profile=release\ne2e_test_cases=13\ne2e_test_suites=2\n');

  const missingShard = runGuard(shard('release-e2e.test.js', 7), 'e2e-release');
  assert.notEqual(missingShard.status, 0);

  const wrongCaseCount = runGuard(
    [shard('release-e2e.test.js', 6), shard('release-e2e-data.test.js', 7)].join('\n'),
    'e2e-release',
  );
  assert.notEqual(wrongCaseCount.status, 0);
  assert.match(
    wrongCaseCount.stderr,
    /Release release-e2e\.test\.js summary expected 7 test cases, received 6/,
  );

  const stalePartition = runGuard(
    [shard('release-e2e.test.js', 7), shard('release-e2e-data.test.js', 5)].join('\n'),
    'e2e-release',
    false,
    { OROT_DETOX_RELEASE_SHARDING: 'true' },
  );
  assert.notEqual(stalePartition.status, 0);
  assert.match(
    stalePartition.stderr,
    /Release release-e2e-data\.test\.js summary expected 6 test cases, received 5/,
  );

  const skippedCase = runGuard(
    [
      shard('release-e2e.test.js', 7),
      shard('release-e2e-data.test.js', 6).replace(
        '6 passed, 6 total',
        '5 passed, 1 skipped, 6 total',
      ),
    ].join('\n'),
    'e2e-release',
  );
  assert.notEqual(skippedCase.status, 0);

  const missingMarkers = runGuard(
    'Test Suites: 1 passed, 1 total\nTests: 13 passed, 13 total\n',
    'e2e-release',
    true,
    { OROT_DETOX_RELEASE_SHARDING: 'true' },
  );
  assert.notEqual(missingMarkers.status, 0);

  // The Release summary and Debug summary still represent one complete E2E profile run.
  const debug = 'Test Suites: 1 passed, 1 total\nTests: 1 passed, 1 total\n';
  const combined = runGuard(complete + '\n' + debug, 'e2e');
  assert.equal(combined.status, 0, combined.stderr);
  assert.match(combined.stdout, /14\/14 tests passed across 3 suites in 3 Jest runs/);
});
