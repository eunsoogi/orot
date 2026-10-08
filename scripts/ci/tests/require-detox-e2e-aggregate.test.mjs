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
    '13',
    '2',
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

test('fails closed when a profile, test count, or configured suite count is absent or incorrect', () => {
  for (const values of [
    ['success', '', '13', '2', 'success', 'openai-provider', '1', '1'],
    ['success', 'openai-provider', '13', '2', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '', '2', 'success', 'openai-provider', '1', '1'],
    // The former inventory must fail after adding the consent-disclosure regression.
    ['success', 'release', '12', '2', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '14', '2', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '13', '0', 'success', 'openai-provider', '1', '1'],
    ['success', 'release', '13', '2', 'success', 'release', '1', '1'],
    ['success', 'release', '13', '2', 'success', 'openai-provider', '0', '1'],
    ['success', 'release', '13', '2', 'success', 'openai-provider', '1', '0'],
  ]) {
    assert.notEqual(runAggregate(values).status, 0, `accepted ${JSON.stringify(values)}`);
  }
});
