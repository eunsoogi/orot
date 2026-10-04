import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const prepareScript = join(repositoryRoot, 'scripts/ci/prepare-detox-simulator.sh');
const teardownScript = join(repositoryRoot, 'scripts/ci/teardown-detox-simulator.sh');
const simulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
const otherSimulatorId = '11111111-2222-4333-8444-555555555555';

function runFakeXcrun(scriptPath, fakeScript, args, extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-simulator-'));
  const binDirectory = join(directory, 'bin');
  const fakeXcrun = join(binDirectory, 'xcrun');
  const callsPath = join(directory, 'xcrun-calls.log');
  const deletedPath = join(directory, 'deleted');
  const logPath = join(directory, 'simulator.log');
  const identityPath = join(directory, 'simulator.udid');
  const outputPath = join(directory, 'github-output');
  const envPath = join(directory, 'github-env');
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(fakeXcrun, [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "$*" >> "$XCRUN_CALLS"',
    fakeScript,
  ].join('\n'), { mode: 0o755 });
  const result = spawnSync('bash', [scriptPath, ...args(logPath, identityPath)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [binDirectory, process.env.PATH].join(':'),
      XCRUN_CALLS: callsPath,
      DELETED_SIMULATOR_MARKER: deletedPath,
      BOOT_STARTED_MARKER: join(directory, 'boot-started'),
      TEST_DETOX_SIMULATOR_UDID: simulatorId,
      GITHUB_OUTPUT: outputPath,
      GITHUB_ENV: envPath,
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '3',
      ...extraEnv,
    },
  });
  const calls = existsSync(callsPath) ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean) : [];
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const output = result.stdout;
  const identity = existsSync(identityPath) ? readFileSync(identityPath, 'utf8') : '';
  const githubOutput = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  const githubEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  rmSync(directory, { recursive: true, force: true });
  return { result, calls, log, output, identity, githubOutput, githubEnv };
}

test('creates and starts one named iPhone 18 Pro on the required iOS runtime', () => {
  const result = runFakeXcrun(
    prepareScript,
    [
      'if [[ "$*" == "simctl list runtimes --json" ]]; then',
      '  printf \'{"runtimes":[{"name":"iOS 27.0","identifier":"com.apple.CoreSimulator.SimRuntime.iOS-27-0","isAvailable":true}]}\\n\'',
      'elif [[ "$1 $2" == "simctl create" ]]; then',
      '  [[ "$3" == "Orot Detox CI 42-3-"* ]] || exit 81',
      '  [[ "$4" == com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro ]] || exit 82',
      '  [[ "$5" == com.apple.CoreSimulator.SimRuntime.iOS-27-0 ]] || exit 83',
      `  printf '%s\\n' "$TEST_DETOX_SIMULATOR_UDID"`,
      `elif [[ "$*" == "simctl boot ${simulatorId}" ]]; then`,
      '  exit 0',
      'else',
      '  exit 97',
      'fi',
    ].join('\n'),
    (logPath, identityPath) => [logPath, identityPath],
  );
  assert.equal(result.result.status, 0, result.result.stderr + result.log);
  assert.equal(result.output.trim(), simulatorId);
  assert.equal(result.identity, `${simulatorId}\n`);
  assert.equal(result.githubOutput, `udid=${simulatorId}\n`);
  assert.equal(
    result.githubEnv,
    `OROT_DETOX_SIMULATOR_UDID=${simulatorId}\nOROT_OPENAI_PROVIDER_SIMULATOR_UDID=${simulatorId}\n`,
  );
  assert.equal(result.calls.length, 3);
  assert.match(
    result.calls[1],
    /simctl create Orot Detox CI 42-3-\d+ com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-18-Pro com\.apple\.CoreSimulator\.SimRuntime\.iOS-27-0/,
  );
  assert.equal(result.calls[2], `simctl boot ${simulatorId}`);
  assert.match(result.log, new RegExp(`UDID ${simulatorId}`));
});

test('fails closed when the required iOS runtime is unavailable before creating a device', () => {
  const result = runFakeXcrun(
    prepareScript,
    [
      'if [[ "$*" == "simctl list runtimes --json" ]]; then',
      '  printf \'{"runtimes":[{"name":"iOS 26.0","identifier":"old-runtime","isAvailable":true}]}\\n\'',
      '  exit 0',
      'fi',
      'exit 97',
    ].join('\n'),
    (logPath, identityPath) => [logPath, identityPath],
  );
  assert.notEqual(result.result.status, 0);
  assert.deepEqual(result.calls, ['simctl list runtimes --json']);
});

test('tears down only the dedicated Simulator and confirms it is absent', () => {
  const result = runFakeXcrun(
    teardownScript,
    [
      `if [[ "$*" == "simctl list devices" ]]; then`,
      `  if [[ ! -f "$DELETED_SIMULATOR_MARKER" ]]; then printf '%s\\n' '${simulatorId} (Booted)'; fi`,
      `  printf '%s\\n' '${otherSimulatorId} (Shutdown)'`,
      `elif [[ "$*" == "simctl list devices booted" ]]; then`,
      `  printf '%s\\n' '${simulatorId} (Booted)'`,
      `elif [[ "$*" == "simctl shutdown ${simulatorId}" ]]; then`,
      '  exit 0',
      `elif [[ "$*" == "simctl delete ${simulatorId}" ]]; then`,
      '  touch "$DELETED_SIMULATOR_MARKER"',
      'else',
      '  exit 97',
      'fi',
    ].join('\n'),
    (logPath) => [simulatorId, logPath],
  );
  assert.equal(result.result.status, 0, result.result.stderr + result.log);
  assert.deepEqual(result.calls, [
    'simctl list devices',
    'simctl list devices booted',
    `simctl shutdown ${simulatorId}`,
    `simctl delete ${simulatorId}`,
    'simctl list devices',
  ]);
  assert.match(result.output, new RegExp(`Deleted dedicated Simulator ${simulatorId}`));
});

test('attempts deletion and preserves a shutdown failure', () => {
  const result = runFakeXcrun(
    teardownScript,
    [
      `if [[ "$*" == "simctl list devices" ]]; then`,
      `  if [[ ! -f "$DELETED_SIMULATOR_MARKER" ]]; then printf '%s\\n' '${simulatorId} (Booted)'; fi`,
      `elif [[ "$*" == "simctl list devices booted" ]]; then`,
      `  printf '%s\\n' '${simulatorId} (Booted)'`,
      `elif [[ "$*" == "simctl shutdown ${simulatorId}" ]]; then`,
      '  exit 23',
      `elif [[ "$*" == "simctl delete ${simulatorId}" ]]; then`,
      '  touch "$DELETED_SIMULATOR_MARKER"',
      'else',
      '  exit 97',
      'fi',
    ].join('\n'),
    (logPath) => [simulatorId, logPath],
  );
  assert.equal(result.result.status, 23);
  assert.ok(result.calls.includes(`simctl delete ${simulatorId}`));
  assert.match(result.log, /shutdown failed/);
});

test('rejects a malformed Simulator identifier without invoking simctl', () => {
  const result = runFakeXcrun(
    teardownScript,
    'exit 97',
    (logPath) => ['not-a-udid', logPath],
  );
  assert.notEqual(result.result.status, 0);
  assert.deepEqual(result.calls, []);
});
