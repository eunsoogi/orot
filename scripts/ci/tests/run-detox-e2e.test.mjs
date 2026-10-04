import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const runner = join(repositoryRoot, 'scripts/ci/run-detox-e2e.sh');

function runRunner({
  releaseStatus = '0',
  debugStatus = '0',
  ci = '',
  simulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE',
  openaiSimulatorId = simulatorId,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-runs-'));
  const fakePnpm = join(directory, 'pnpm');
  const callsPath = join(directory, 'calls.log');
  const artifactsPath = join(directory, 'artifacts');
  writeFileSync(fakePnpm, [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "$*" >> "$DETOX_CALL_LOG"',
    'printf \'Test Suites: 1 passed, 1 total\\nTests: 1 passed, 1 total\\n\'',
    'if [[ "$*" == *"ios.sim.release"* ]]; then exit "$RELEASE_STATUS"; fi',
    'if [[ "$*" == *"ios.sim.debug.openai-provider"* ]]; then exit "$DEBUG_STATUS"; fi',
    'exit 97',
  ].join('\n'), { mode: 0o755 });

  const result = spawnSync('bash', [runner], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [directory, process.env.PATH].join(':'),
      DETOX_ARTIFACTS_LOCATION: artifactsPath,
      DETOX_CALL_LOG: callsPath,
      RELEASE_STATUS: releaseStatus,
      DEBUG_STATUS: debugStatus,
      CI: ci,
      OROT_DETOX_SIMULATOR_UDID: simulatorId,
      OROT_OPENAI_PROVIDER_SIMULATOR_UDID: openaiSimulatorId,
    },
  });
  const calls = existsSync(callsPath)
    ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  rmSync(directory, { recursive: true, force: true });
  return { result, calls, artifactsPath };
}

test('runs Release and OpenAI Debug under separate artifact paths', () => {
  const { result, calls, artifactsPath } = runRunner();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /ios\.sim\.release/);
  assert.match(calls[0], new RegExp(`${artifactsPath}/release`));
  assert.match(calls[1], /openai-provider\.detox\.config\.js/);
  assert.match(calls[1], /ios\.sim\.debug\.openai-provider/);
  assert.match(calls[1], new RegExp(`${artifactsPath}/openai-provider`));
});

test('still runs Debug after a Release failure and fails if either invocation fails', () => {
  for (const statuses of [
    { releaseStatus: '1', debugStatus: '0' },
    { releaseStatus: '0', debugStatus: '2' },
  ]) {
    const { result, calls } = runRunner(statuses);
    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 2);
  }
});

test('fails closed when no dedicated Simulator was prepared', () => {
  const { result, calls } = runRunner({ simulatorId: '', openaiSimulatorId: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated Detox Simulator UDID/);
  assert.deepEqual(calls, []);
});

test('fails closed in CI when the app configurations disagree on Simulator identity', () => {
  const { result, calls } = runRunner({ ci: 'true', simulatorId: 'A1B2', openaiSimulatorId: 'C3D4' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use the same dedicated Detox Simulator/);
  assert.deepEqual(calls, []);
});
