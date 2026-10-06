import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { installDetoxHostSamplerStubs } from './detox-host-sampling-stubs.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const runner = join(repositoryRoot, 'scripts/ci/run-detox-e2e.sh');
const runnerSource = readFileSync(runner, 'utf8');

function runRunner({
  profile = 'both',
  releaseStatus = '0',
  debugStatus = '0',
  transcriptionStatus = '0',
  ci = '',
  resourceLog = false,
  logLevel = 'info',
  simulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE',
  openaiSimulatorId = simulatorId,
  transcriptionSimulatorId = simulatorId,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-runs-'));
  const fakePnpm = join(directory, 'pnpm');
  const callsPath = join(directory, 'calls.log');
  const samplerCallsPath = join(directory, 'sampler-calls.log');
  const artifactsPath = join(directory, 'artifacts');
  const resourceLogPath = join(directory, 'detox-resource-samples.log');
  writeFileSync(
    fakePnpm,
    [
      '#!/usr/bin/env bash',
      'printf \'profile=%s %s\\n\' "${OROT_DETOX_TEST_PROFILE:-}" "$*" >> "$DETOX_CALL_LOG"',
      "printf 'Test Suites: 1 passed, 1 total\\nTests: 1 passed, 1 total\\n'",
      'if [[ "$*" == *"ios.sim.release.transcription"* ]]; then exit "$TRANSCRIPTION_STATUS"; fi',
      'if [[ "$*" == *"ios.sim.release"* ]]; then exit "$RELEASE_STATUS"; fi',
      'if [[ "$*" == *"ios.sim.debug.openai-provider"* ]]; then exit "$DEBUG_STATUS"; fi',
      'exit 97',
    ].join('\n'),
    { mode: 0o755 },
  );
  if (resourceLog) installDetoxHostSamplerStubs(directory);

  const args = profile === 'both' ? [] : [profile];
  const result = spawnSync('bash', [runner, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [directory, process.env.PATH].join(':'),
      DETOX_ARTIFACTS_LOCATION: artifactsPath,
      DETOX_CALL_LOG: callsPath,
      DETOX_SAMPLER_CALLS: samplerCallsPath,
      RELEASE_STATUS: releaseStatus,
      DEBUG_STATUS: debugStatus,
      TRANSCRIPTION_STATUS: transcriptionStatus,
      CI: ci,
      OROT_DETOX_RESOURCE_LOG_PATH: resourceLog ? resourceLogPath : '',
      OROT_DETOX_RESOURCE_SAMPLING: resourceLog ? 'true' : 'false',
      OROT_DETOX_TEST_LOG_LEVEL: logLevel,
      OROT_DETOX_SIMULATOR_UDID: simulatorId,
      OROT_OPENAI_PROVIDER_SIMULATOR_UDID: openaiSimulatorId,
      OROT_SPEECH_TRANSCRIPTION_SIMULATOR_UDID: transcriptionSimulatorId,
    },
  });
  const calls = existsSync(callsPath)
    ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  const resourceSamples = existsSync(resourceLogPath) ? readFileSync(resourceLogPath, 'utf8') : '';
  const samplerCalls = existsSync(samplerCallsPath) ? readFileSync(samplerCallsPath, 'utf8') : '';
  rmSync(directory, { recursive: true, force: true });
  return { result, calls, artifactsPath, resourceSamples, samplerCalls };
}

test('runs Release and OpenAI Debug under separate artifact paths', () => {
  const { result, calls, artifactsPath } = runRunner();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^profile=release /);
  assert.match(calls[1], /^profile=openai-provider /);
  assert.match(calls[0], /ios\.sim\.release/);
  assert.match(
    calls[0],
    /--config-path \.\.\/\.\.\/scripts\/ci\/detox-e2e-profile\.detox\.config\.cjs/,
  );
  assert.match(calls[0], new RegExp(`${artifactsPath}/release`));
  assert.match(
    calls[1],
    /--config-path \.\.\/\.\.\/scripts\/ci\/detox-e2e-profile\.detox\.config\.cjs/,
  );
  assert.match(calls[1], /ios\.sim\.debug\.openai-provider/);
  assert.match(calls[1], new RegExp(`${artifactsPath}/openai-provider`));
});

test('runs only the selected Release profile on its dedicated Simulator', () => {
  const simulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
  const { result, calls, artifactsPath } = runRunner({
    profile: 'release',
    simulatorId,
    openaiSimulatorId: '',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^profile=release /);
  assert.match(calls[0], /ios\.sim\.release/);
  assert.match(
    calls[0],
    /--config-path \.\.\/\.\.\/scripts\/ci\/detox-e2e-profile\.detox\.config\.cjs/,
  );
  assert.match(calls[0], new RegExp(`${artifactsPath}/release`));
});

test('runs only the Debug-only OpenAI probe on its dedicated Simulator', () => {
  const simulatorId = '';
  const openaiSimulatorId = '11111111-2222-4333-8444-555555555555';
  const { result, calls, artifactsPath } = runRunner({
    profile: 'openai-provider',
    simulatorId,
    openaiSimulatorId,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^profile=openai-provider /);
  assert.match(
    calls[0],
    /--config-path \.\.\/\.\.\/scripts\/ci\/detox-e2e-profile\.detox\.config\.cjs/,
  );
  assert.match(calls[0], /ios\.sim\.debug\.openai-provider/);
  assert.match(calls[0], new RegExp(`${artifactsPath}/openai-provider`));
});

test('runs only the transcription probe with its separately prepared Simulator', () => {
  const simulatorId = '';
  const transcriptionSimulatorId = '22222222-3333-4444-8555-666666666666';
  const { result, calls, artifactsPath } = runRunner({
    profile: 'transcription',
    simulatorId,
    openaiSimulatorId: '',
    transcriptionSimulatorId,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^profile=transcription /);
  assert.match(calls[0], /ios\.sim\.release\.transcription/);
  assert.match(calls[0], new RegExp(`${artifactsPath}/transcription`));
});

test('fails closed when the transcription profile lacks its dedicated Simulator', () => {
  const { result, calls } = runRunner({
    profile: 'transcription',
    simulatorId: '',
    openaiSimulatorId: '',
    transcriptionSimulatorId: '',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated speech transcription Detox Simulator UDID/);
  assert.deepEqual(calls, []);
});

test('can record bounded process and memory samples when explicitly enabled', () => {
  const { result, calls, resourceSamples, samplerCalls } = runRunner({
    profile: 'release',
    resourceLog: true,
    logLevel: 'info',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(calls[0], /--loglevel info/);
  assert.match(result.stderr, /real/);
  assert.match(resourceSamples, /DETOX_RESOURCE_SAMPLE profile=release phase=before/);
  assert.match(resourceSamples, /DETOX_RESOURCE_SAMPLE profile=release phase=after/);
  assert.match(resourceSamples, /Pages free:/);
  assert.match(resourceSamples, /Pageins:/);
  assert.match(resourceSamples, /Pageouts:/);
  assert.match(runnerSource, /resource_sample_limit=4/);
  assert.match(runnerSource, /sample_index < resource_sample_limit/);
  assert.match(resourceSamples, /DETOX_TOP_SAMPLE cpu_is_delta_between_two_samples/);
  assert.match(resourceSamples, /CPU usage:/);
  assert.match(resourceSamples, /vm\.swapusage/);
  for (const command of ['ps', 'top', 'vm_stat', 'sysctl', 'uname']) {
    assert.match(samplerCalls, new RegExp(`^${command}(?: |$)`, 'm'));
  }
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
  assert.match(result.stderr, /dedicated Release Detox Simulator UDID/);
  assert.deepEqual(calls, []);
});

test('fails closed in CI when the app configurations disagree on Simulator identity', () => {
  const { result, calls } = runRunner({
    ci: 'true',
    simulatorId: 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE',
    openaiSimulatorId: '11111111-2222-4333-8444-555555555555',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use the same dedicated Simulator/);
  assert.deepEqual(calls, []);
});
