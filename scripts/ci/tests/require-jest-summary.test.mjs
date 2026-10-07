import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardScript = fileURLToPath(new URL('../require-jest-summary.mjs', import.meta.url));

function runGuard(log, suiteName = 'unit', emitGithubOutputs = false) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-jest-summary-'));
  const logPath = join(directory, 'jest.log');
  const outputPath = join(directory, 'github-output');
  try {
    writeFileSync(logPath, log);
    const result = spawnSync(
      process.execPath,
      [guardScript, logPath, suiteName, ...(emitGithubOutputs ? [outputPath] : [])],
      { encoding: 'utf8' },
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
  const release = 'Test Suites: 1 passed, 1 total\nTests: 11 passed, 11 total\n';
  const debug = 'Test Suites: 1 passed, 1 total\nTests: 1 passed, 1 total\n';
  const complete = runGuard(release + debug, 'e2e');
  assert.equal(complete.status, 0, complete.stderr);
  assert.match(complete.stdout, /12\/12 tests passed across 2 suites in 2 Jest runs/);

  const missingDebug = runGuard(release, 'e2e');
  assert.notEqual(missingDebug.status, 0);
  assert.match(missingDebug.stderr, /expected one Release and one OpenAI Debug Jest summary/);

  const incompleteRelease = runGuard(
    'Test Suites: 1 passed, 1 total\nTests: 10 passed, 10 total\n' + debug,
    'e2e',
  );
  assert.notEqual(incompleteRelease.status, 0);
  assert.match(incompleteRelease.stderr, /Release summary expected 11 test cases, received 10/);
});

test('validates a single CI profile and publishes only its proven counts', () => {
  const release = runGuard(
    'Test Suites: 1 passed, 1 total\nTests: 11 passed, 11 total\n',
    'e2e-release',
    true,
  );
  assert.equal(release.status, 0, release.stderr);
  assert.match(release.stdout, /11\/11 tests passed across 1 suites in 1 Jest runs/);
  assert.equal(release.githubOutput, 'e2e_profile=release\ne2e_test_cases=11\ne2e_test_suites=1\n');

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
    runGuard('Test Suites: 1 passed, 1 total\nTests: 10 passed, 10 total\n', 'e2e-release').status,
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
