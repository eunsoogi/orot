import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardScript = fileURLToPath(new URL('../require-jest-summary.mjs', import.meta.url));

function runGuard(log, suiteName = 'unit', emitGithubOutputs = false, extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-jest-summary-'));
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

test('accepts a nonzero Jest run with no skipped tests', () => {
  const result = runGuard('Test Suites: 1 passed, 1 total\nTests: 1 passed, 1 total\n');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\/1 tests passed/);
});

test('validates every Jest summary when the root command runs multiple packages', () => {
  const result = runGuard(
    [
      'Test Suites: 1 passed, 1 total',
      'Tests: 2 passed, 2 total',
      'Test Suites: 1 passed, 1 total',
      'Tests: 3 passed, 3 total',
    ].join('\n'),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /5\/5 tests passed across 2 suites in 2 Jest runs/);

  const firstRunSkipped = runGuard(
    [
      'Test Suites: 1 passed, 1 total',
      'Tests: 1 skipped, 1 total',
      'Test Suites: 1 passed, 1 total',
      'Tests: 3 passed, 3 total',
    ].join('\n'),
  );
  assert.notEqual(firstRunSkipped.status, 0);

  const firstRunEmpty = runGuard(
    [
      'Test Suites: 0 total',
      'Tests: 0 total',
      'Test Suites: 1 passed, 1 total',
      'Tests: 3 passed, 3 total',
    ].join('\n'),
  );
  assert.notEqual(firstRunEmpty.status, 0);
  assert.match(firstRunEmpty.stderr, /run 1 discovered zero tests or suites/);
});

test('requires both the Release and OpenAI Debug E2E summaries', () => {
  const release = 'Test Suites: 1 passed, 1 total\nTests: 13 passed, 13 total\n';
  const debug = 'Test Suites: 1 passed, 1 total\nTests: 1 passed, 1 total\n';
  const complete = runGuard(release + debug, 'e2e');
  assert.equal(complete.status, 0, complete.stderr);
  assert.match(complete.stdout, /14\/14 tests passed across 2 suites in 2 Jest runs/);

  const missingDebug = runGuard(release, 'e2e');
  assert.notEqual(missingDebug.status, 0);
  assert.match(missingDebug.stderr, /expected one Release and one OpenAI Debug Jest summary/);

  const incompleteRelease = runGuard(
    'Test Suites: 1 passed, 1 total\nTests: 12 passed, 12 total\n' + debug,
    'e2e',
  );
  assert.notEqual(incompleteRelease.status, 0);
  assert.match(incompleteRelease.stderr, /Release summary expected 13 test cases, received 12/);
});

test('validates a single CI profile and publishes only its proven counts', () => {
  const release = runGuard(
    'Test Suites: 1 passed, 1 total\nTests: 13 passed, 13 total\n',
    'e2e-release',
    true,
  );
  assert.equal(release.status, 0, release.stderr);
  assert.match(release.stdout, /13\/13 tests passed across 1 suites in 1 Jest runs/);
  assert.equal(release.githubOutput, 'e2e_profile=release\ne2e_test_cases=13\ne2e_test_suites=1\n');

  const debug = runGuard(
    'Test Suites: 1 passed, 1 total\nTests: 1 passed, 1 total\n',
    'e2e-openai-provider',
    true,
  );
  assert.equal(debug.status, 0, debug.stderr);
  assert.match(debug.stdout, /1\/1 tests passed across 1 suites in 1 Jest runs/);
  assert.equal(
    debug.githubOutput,
    'e2e_profile=openai-provider\ne2e_test_cases=1\ne2e_test_suites=1\n',
  );

  const transcription = runGuard(
    'Test Suites: 1 passed, 1 total\nTests: 1 passed, 1 total\n',
    'e2e-transcription',
    true,
  );
  assert.equal(transcription.status, 0, transcription.stderr);
  assert.equal(
    transcription.githubOutput,
    'e2e_profile=transcription\ne2e_test_cases=1\ne2e_test_suites=1\n',
  );

  assert.notEqual(
    runGuard('Test Suites: 1 passed, 1 total\nTests: 12 passed, 12 total\n', 'e2e-release').status,
    0,
  );
  assert.notEqual(
    runGuard('Test Suites: 1 passed, 1 total\nTests: 0 total\n', 'e2e-openai-provider').status,
    0,
  );
  assert.notEqual(
    runGuard('Test Suites: 1 passed, 1 total\nTests: 2 passed, 2 total\n', 'e2e-transcription')
      .status,
    0,
  );
  assert.notEqual(
    runGuard('Test Suites: 1 passed, 1 total\nTests: 9 passed, 9 total\n', 'e2e', true).status,
    0,
  );
  assert.notEqual(
    runGuard('Test Suites: 1 passed, 1 total\nTests: 1 passed, 1 total\n', 'e2e-typo').status,
    0,
  );
});

test('validates every explicit Release shard before publishing the profile total', () => {
  const shard = (name, tests) =>
    [
      `DETOX_RELEASE_SHARD_SUMMARY_START shard=${name}`,
      'Test Suites: 1 passed, 1 total',
      `Tests: ${tests} passed, ${tests} total`,
      `DETOX_RELEASE_SHARD_SUMMARY_END shard=${name}`,
    ].join('\n');
  const complete = [shard('release-e2e.test.js', 5), shard('release-e2e-data.test.js', 8)].join(
    '\n',
  );
  const result = runGuard(complete, 'e2e-release', true, {
    OROT_DETOX_RELEASE_SHARDING: 'true',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /13\/13 tests passed across 2 suites in 2 Jest runs/);
  assert.equal(result.githubOutput, 'e2e_profile=release\ne2e_test_cases=13\ne2e_test_suites=2\n');

  const missingShard = runGuard(shard('release-e2e.test.js', 5), 'e2e-release');
  assert.notEqual(missingShard.status, 0);

  const wrongCaseCount = runGuard(
    [shard('release-e2e.test.js', 4), shard('release-e2e-data.test.js', 9)].join('\n'),
    'e2e-release',
  );
  assert.notEqual(wrongCaseCount.status, 0);

  const skippedCase = runGuard(
    [
      shard('release-e2e.test.js', 5),
      shard('release-e2e-data.test.js', 8).replace(
        '8 passed, 8 total',
        '7 passed, 1 skipped, 8 total',
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

  const debug = 'Test Suites: 1 passed, 1 total\nTests: 1 passed, 1 total\n';
  const combined = runGuard(complete + '\n' + debug, 'e2e');
  assert.equal(combined.status, 0, combined.stderr);
  // Two explicit shard summaries plus the Debug summary still represent three Jest suites.
  assert.match(combined.stdout, /14\/14 tests passed across 3 suites in 3 Jest runs/);
});

test('rejects missing summaries and zero discovered tests', () => {
  const missing = runGuard('No Jest summary was emitted\n');
  assert.notEqual(missing.status, 0);

  const zero = runGuard('Test Suites: 0 total\nTests: 0 total\n');
  assert.notEqual(zero.status, 0);
  assert.match(zero.stderr, /zero tests or suites/);
});

test('rejects skipped, pending, and todo tests even when another test passed', () => {
  for (const state of ['skipped', 'pending', 'todo']) {
    const result = runGuard(
      `Test Suites: 1 passed, 1 total\nTests: 1 passed, 1 ${state}, 2 total\n`,
    );
    assert.notEqual(result.status, 0, `accepted ${state} result`);
    assert.match(result.stderr, /failure, skip, pending test, or todo/);
  }
});
