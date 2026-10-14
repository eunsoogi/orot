import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyAppleModelHost } from '../verify-apple-model-host.mjs';

const evidence = {
  scope: 'host-sdk-prewarm',
  before: 'available',
  after: 'available',
  koreanSupported: true,
  prewarmInvoked: true,
  generatedFixture: false,
};
const log = (changes = {}) => JSON.stringify({ ...evidence, ...changes }) + '\n';

test('host prewarm cannot certify unsupported, disabled, unready or unknown Apple Intelligence', () => {
  for (const state of ['unsupportedDevice', 'disabled', 'modelNotReady', 'unknown', null])
    for (const field of ['before', 'after'])
      assert.throws(() => verifyAppleModelHost(log({ [field]: state })), /not available/);
});

test('missing, ambiguous, synthetic or incomplete host observations fail closed', () => {
  for (const text of ['', 'not JSON\n', log() + log(), log({ scope: 'fixture' })])
    assert.throws(() => verifyAppleModelHost(text), /Missing or ambiguous/);
  for (const changes of [
    { koreanSupported: false },
    { prewarmInvoked: false },
    { generatedFixture: true },
  ])
    assert.throws(() => verifyAppleModelHost(log(changes)), /Incomplete authentic/);
});

test('an actual available observation passes only the host gate, with native generation still separate', () => {
  assert.deepEqual(verifyAppleModelHost('compiler diagnostic\n' + log()), evidence);
});

test('CLI preserves unsupportedDevice in its failed status and visible job summary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-apple-host-required-'));
  try {
    const input = join(directory, 'host.log');
    const summary = join(directory, 'summary.md');
    writeFileSync(input, log({ before: 'unsupportedDevice', after: 'unsupportedDevice' }));
    const result = spawnSync(process.execPath, ['scripts/ci/verify-apple-model-host.mjs', input], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /before=unsupportedDevice, after=unsupportedDevice/);
    assert.match(readFileSync(summary, 'utf8'), /unsupportedDevice/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
