import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Exercise the command-line boundary used by the aggregate job, including terminal child states.
const aggregateScript = fileURLToPath(new URL('../require-quality-aggregate.mjs', import.meta.url));

function runAggregate(values) {
  return spawnSync(process.execPath, [aggregateScript, ...values], { encoding: 'utf8' });
}

test('accepts the complete successful Linux and macOS quality partitions', () => {
  const result = runAggregate(['success', 'success']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Linux portable and macOS Apple-tool quality partitions passed/);
});

test('fails closed when a quality partition failed, was canceled, skipped, or is missing', () => {
  for (const status of ['failure', 'cancelled', 'skipped', '']) {
    for (const values of [
      [status, 'success'],
      ['success', status],
    ]) {
      const result = runAggregate(values);
      assert.notEqual(result.status, 0, `accepted results ${JSON.stringify(values)}`);
      assert.match(result.stderr, /job must succeed/);
    }
  }
});

test('rejects an absent or extra partition result', () => {
  for (const values of [['success'], ['success', 'success', 'success']]) {
    const result = runAggregate(values);
    assert.notEqual(result.status, 0, `accepted results ${JSON.stringify(values)}`);
    assert.match(result.stderr, /Usage: node require-quality-aggregate/);
  }
});
