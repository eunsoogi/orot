import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const aggregateScript = fileURLToPath(
  new URL('../require-detox-transcription-aggregate.mjs', import.meta.url),
);

function runAggregate(values) {
  return spawnSync(process.execPath, [aggregateScript, ...values], { encoding: 'utf8' });
}

test('accepts exactly one successful transcription case while preserving the separate nine-case aggregate', () => {
  const result = runAggregate(['success', 'transcription', '1', '1']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\/1 Speech Transcription test passed/);
});

test('fails closed for any missing job result, wrong profile, case count, or suite count', () => {
  for (const values of [
    ['', 'transcription', '1', '1'],
    ['failure', 'transcription', '1', '1'],
    ['success', 'release', '1', '1'],
    ['success', 'transcription', '0', '1'],
    ['success', 'transcription', '2', '1'],
    ['success', 'transcription', '1', '0'],
    ['success', 'transcription', '1', '2'],
  ]) {
    assert.notEqual(runAggregate(values).status, 0, `accepted ${JSON.stringify(values)}`);
  }
});
