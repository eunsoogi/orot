import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardScript = fileURLToPath(new URL('../require-jest-summary.mjs', import.meta.url));

function runGuard(log) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-jest-summary-'));
  const logPath = join(directory, 'jest.log');
  try {
    writeFileSync(logPath, log);
    return spawnSync(process.execPath, [guardScript, logPath, 'unit'], { encoding: 'utf8' });
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
