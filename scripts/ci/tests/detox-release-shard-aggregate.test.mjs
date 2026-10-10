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

// The aggregate consumes the current UI/storage and stateful-data shard summaries.
const completeReleaseShards = ['success', 'release', '15', '1', 'success', 'release', '6', '1'];

test('publishes the full Release inventory only after both hosted shards pass', () => {
  const result = runAggregate(completeReleaseShards);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'e2e_profile=release\ne2e_test_cases=21\ne2e_test_suites=2\n');
  assert.match(result.stdout, /21\/21 Release cases passed across both shard suites/);
});

test('fails closed for missing, failed, malformed, or incomplete shard results', () => {
  const complete = completeReleaseShards;
  for (const status of ['failure', 'cancelled', 'skipped', '']) {
    const result = runAggregate([status, ...complete.slice(1)]);
    assert.notEqual(result.status, 0, 'accepted first shard status ' + JSON.stringify(status));
    assert.equal(result.output, '');
  }

  for (const values of [
    ['success', '', '15', '1', ...complete.slice(4)],
    ['success', 'openai-provider', '15', '1', ...complete.slice(4)],
    ['success', 'release', '14', '1', ...complete.slice(4)],
    ['success', 'release', '15', '2', ...complete.slice(4)],
    [...complete.slice(0, 4), 'success', 'release', '5', '1'],
  ]) {
    const result = runAggregate(values);
    assert.notEqual(result.status, 0, 'accepted ' + JSON.stringify(values));
    assert.equal(result.output, '');
  }
});
