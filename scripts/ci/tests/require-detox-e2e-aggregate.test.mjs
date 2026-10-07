import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const aggregateScript = fileURLToPath(
  new URL('../require-detox-e2e-aggregate.mjs', import.meta.url),
);

function runAggregate(values) {
  return spawnSync(process.execPath, [aggregateScript, ...values], { encoding: 'utf8' });
}

test('accepts successful Release and OpenAI Debug jobs with the complete case inventory', () => {
  const result = runAggregate([
    'success',
    'release',
    '11',
    '1',
    'success',
    'openai-provider',
    '1',
    '1',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /12\/12 tests passed across Release \(11\) and OpenAI Debug \(1\)/);
});

test('fails closed when either child job failed, was canceled, skipped, or is missing', () => {
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    const failedRelease = runAggregate([
      result,
      'release',
      '11',
      '1',
      'success',
      'openai-provider',
      '1',
      '1',
    ]);
    assert.notEqual(failedRelease.status, 0, `accepted Release result ${JSON.stringify(result)}`);

    const failedDebug = runAggregate([
      'success',
      'release',
      '11',
      '1',
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

test('fails closed when a profile, test count, or configured suite count is absent or incorrect', () => {
  for (const values of [
    ['success', '', '11', '1', 'success', 'openai-provider', '1', '1'],
    ['success', 'openai-provider', '11', '1', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '', '1', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '10', '1', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '11', '0', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '11', '1', 'success', 'release', '1', '1'],
    ['success', 'release', '11', '1', 'success', 'openai-provider', '0', '1'],
    ['success', 'release', '11', '1', 'success', 'openai-provider', '1', '0'],
  ]) {
    assert.notEqual(runAggregate(values).status, 0, `accepted ${JSON.stringify(values)}`);
  }
});
