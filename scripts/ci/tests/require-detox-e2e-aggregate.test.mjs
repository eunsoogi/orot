import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const aggregateScript = fileURLToPath(
  new URL('../require-detox-e2e-aggregate.mjs', import.meta.url),
);
const releaseShardAggregateScript = fileURLToPath(
  new URL('../require-detox-release-shard-aggregate.mjs', import.meta.url),
);

function runAggregate(values) {
  return spawnSync(process.execPath, [aggregateScript, ...values], { encoding: 'utf8' });
}

function runReleaseShardAggregate(values) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-profile-aggregate-'));
  const outputPath = join(directory, 'github-output');
  try {
    const result = spawnSync(
      process.execPath,
      [releaseShardAggregateScript, ...values, outputPath],
      { encoding: 'utf8' },
    );
    return {
      ...result,
      githubOutput: existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '',
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('accepts actual two-shard Release output and OpenAI Debug with the complete case inventory', () => {
  // Exercise the serialized boundary from both Release runners through the outer profile check.
  const release = runReleaseShardAggregate([
    'success',
    'release',
    '7',
    '1',
    'success',
    'release',
    '6',
    '1',
  ]);
  assert.equal(release.status, 0, release.stderr);
  assert.equal(release.githubOutput, 'e2e_profile=release\ne2e_test_cases=13\ne2e_test_suites=2\n');
  const releaseOutput = Object.fromEntries(
    release.githubOutput
      .trim()
      .split('\n')
      .map((entry) => entry.split('=', 2)),
  );
  const result = runAggregate([
    'success',
    releaseOutput.e2e_profile,
    releaseOutput.e2e_test_cases,
    releaseOutput.e2e_test_suites,
    'success',
    'openai-provider',
    '1',
    '1',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /14\/14 tests passed across Release \(13\) and OpenAI Debug \(1\)/);
});

test('fails closed when either child job failed, was canceled, skipped, or is missing', () => {
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    const failedRelease = runAggregate([
      result,
      'release',
      '13',
      '2',
      'success',
      'openai-provider',
      '1',
      '1',
    ]);
    assert.notEqual(failedRelease.status, 0, `accepted Release result ${JSON.stringify(result)}`);

    const failedDebug = runAggregate([
      'success',
      'release',
      '13',
      '2',
      result,
      'openai-provider',
      '1',
      '1',
    ]);
    assert.notEqual(
      failedDebug.status,
      0,
      `accepted OpenAI Debug result ${JSON.stringify(result)}`,
    );
  }
});

test('rejects the former three-suite Release output after moving Safe Area into the data shard', () => {
  const result = runAggregate([
    'success',
    'release',
    '13',
    '3',
    'success',
    'openai-provider',
    '1',
    '1',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must report exactly 2 Jest suites/);
});

test('fails closed when a profile, test count, or configured suite count is absent or incorrect', () => {
  for (const values of [
    ['success', '', '13', '2', 'success', 'openai-provider', '1', '1'],
    ['success', 'openai-provider', '13', '2', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '', '2', 'success', 'openai-provider', '1', '1'],
    // The former inventory must fail after adding the consent-disclosure regression.
    ['success', 'release', '12', '2', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '14', '2', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '13', '1', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '13', '0', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '13', '3', 'success', 'release', '1', '1'],
    ['success', 'release', '13', '2', 'success', 'openai-provider', '0', '1'],
    ['success', 'release', '13', '2', 'success', 'openai-provider', '1', '0'],
  ]) {
    assert.notEqual(runAggregate(values).status, 0, `accepted ${JSON.stringify(values)}`);
  }
});
