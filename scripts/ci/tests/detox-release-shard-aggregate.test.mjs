import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const aggregateScript = fileURLToPath(
  new URL('../require-detox-release-shard-aggregate.mjs', import.meta.url),
);

function runAggregate(values) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-shard-aggregate-'));
  const outputPath = join(directory, 'github-output');
  try {
    const result = spawnSync(process.execPath, [aggregateScript, ...values, outputPath], {
      encoding: 'utf8',
    });
    return {
      ...result,
      output: existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '',
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('publishes the full Release inventory only after both hosted shards pass', () => {
  const result = runAggregate(['success', 'release', '3', '1', 'success', 'release', '10', '1']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'e2e_profile=release\ne2e_test_cases=13\ne2e_test_suites=2\n');
  assert.match(result.stdout, /13\/13 Release cases passed across both shard suites/);
});

test('fails closed for missing, failed, malformed, or incomplete shard results', () => {
  const complete = ['success', 'release', '3', '1', 'success', 'release', '10', '1'];
  for (const status of ['failure', 'cancelled', 'skipped', '']) {
    const result = runAggregate([status, ...complete.slice(1)]);
    assert.notEqual(result.status, 0, 'accepted first shard status ' + JSON.stringify(status));
    assert.equal(result.output, '');
  }

  for (const values of [
    ['success', '', '3', '1', ...complete.slice(4)],
    ['success', 'openai-provider', '3', '1', ...complete.slice(4)],
    ['success', 'release', '2', '1', ...complete.slice(4)],
    ['success', 'release', '3', '2', ...complete.slice(4)],
    [...complete.slice(0, 4), 'success', 'release', '9', '1'],
  ]) {
    const result = runAggregate(values);
    assert.notEqual(result.status, 0, 'accepted ' + JSON.stringify(values));
    assert.equal(result.output, '');
  }
});
