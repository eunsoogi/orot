import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const prepareScript = join(repositoryRoot, 'scripts/ci/prepare-detox-simulator.sh');
const waitScript = join(repositoryRoot, 'scripts/ci/wait-detox-simulator.sh');
const teardownScript = join(repositoryRoot, 'scripts/ci/teardown-detox-simulator.sh');
const simulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';

function startFake(scriptPath, args, fakeScript, extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-recovery-'));
  const binDirectory = join(directory, 'bin');
  const callsPath = join(directory, 'xcrun-calls.log');
  const deletedPath = join(directory, 'deleted');
  const logPath = join(directory, 'simulator.log');
  const identityPath = join(directory, 'simulator.udid');
  const bootStartedPath = join(directory, 'boot-started');
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(
    join(binDirectory, 'xcrun'),
    ['#!/usr/bin/env bash', 'printf \'%s\\n\' "$*" >> "$XCRUN_CALLS"', fakeScript].join('\n'),
    { mode: 0o755 },
  );
  const child = spawn('bash', [scriptPath, ...args({ logPath, identityPath })], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PATH: [binDirectory, process.env.PATH].join(':'),
      XCRUN_CALLS: callsPath,
      DELETED_SIMULATOR_MARKER: deletedPath,
      BOOT_STARTED_MARKER: bootStartedPath,
      TEST_DETOX_SIMULATOR_UDID: simulatorId,
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '3',
      ...extraEnv,
    },
  });
  const closed = once(child, 'close').then(([code, signal]) => ({ code, signal }));
  return { child, closed, directory, callsPath, logPath, identityPath, bootStartedPath };
}

async function waitUntil(predicate, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

async function stopGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function callsFrom(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean) : [];
}

test('cancellation during boot cleans up the already-published dedicated Simulator', async () => {
  const harness = startFake(
    prepareScript,
    ({ logPath, identityPath }) => [logPath, identityPath],
    [
      'if [[ "$*" == "simctl list runtimes --json" ]]; then',
      '  printf \'{"runtimes":[{"name":"iOS 27.0","identifier":"runtime-27","isAvailable":true}]}\\n\'',
      'elif [[ "$1 $2" == "simctl create" ]]; then',
      '  printf \'%s\\n\' "$TEST_DETOX_SIMULATOR_UDID"',
      `elif [[ "$*" == "simctl boot ${simulatorId}" ]]; then`,
      '  touch "$BOOT_STARTED_MARKER"',
      '  while true; do sleep 1; done',
      `elif [[ "$*" == "simctl shutdown ${simulatorId}" ]]; then`,
      '  exit 0',
      `elif [[ "$*" == "simctl delete ${simulatorId}" ]]; then`,
      '  exit 0',
      'else',
      '  exit 97',
      'fi',
    ].join('\n'),
  );

  try {
    const enteredBoot = await waitUntil(
      () => existsSync(harness.bootStartedPath) || harness.child.exitCode !== null,
      10000,
    );
    assert.ok(
      enteredBoot && existsSync(harness.bootStartedPath),
      'preparation reached the boot command',
    );
    assert.equal(readFileSync(harness.identityPath, 'utf8'), `${simulatorId}\n`);
    try {
      process.kill(-harness.child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    const result = await Promise.race([
      harness.closed,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    assert.ok(result, 'canceled preparation exited after cleanup');
    assert.notEqual(result.code, 0);
    const calls = callsFrom(harness.callsPath);
    assert.ok(calls.includes(`simctl shutdown ${simulatorId}`), calls.join('\n'));
    assert.ok(calls.includes(`simctl delete ${simulatorId}`), calls.join('\n'));
  } finally {
    await stopGroup(harness.child);
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test('boot wait returns a bounded failure when simctl stalls', async () => {
  const harness = startFake(
    waitScript,
    () => [simulatorId],
    [
      `if [[ "$*" == "simctl bootstatus ${simulatorId} -b" ]]; then`,
      '  while true; do sleep 1; done',
      'fi',
      'exit 97',
    ].join('\n'),
    { OROT_DETOX_SIMCTL_TIMEOUT_MS: '150' },
  );

  try {
    const result = await Promise.race([
      harness.closed,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    assert.ok(result, 'the stalled boot wait exited before the test bound');
    assert.equal(result.code, 124);
  } finally {
    await stopGroup(harness.child);
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test('teardown attempts deletion after the bounded shutdown command stalls', async () => {
  const harness = startFake(
    teardownScript,
    ({ logPath }) => [simulatorId, logPath],
    [
      `if [[ "$*" == "simctl list devices" ]]; then`,
      `  if [[ ! -f "$DELETED_SIMULATOR_MARKER" ]]; then printf '%s\\n' '${simulatorId} (Booted)'; fi`,
      `elif [[ "$*" == "simctl list devices booted" ]]; then`,
      `  printf '%s\\n' '${simulatorId} (Booted)'`,
      `elif [[ "$*" == "simctl shutdown ${simulatorId}" ]]; then`,
      '  while true; do sleep 1; done',
      `elif [[ "$*" == "simctl delete ${simulatorId}" ]]; then`,
      '  touch "$DELETED_SIMULATOR_MARKER"',
      'else',
      '  exit 97',
      'fi',
    ].join('\n'),
    { OROT_DETOX_SIMCTL_TIMEOUT_MS: '150' },
  );

  try {
    const result = await Promise.race([
      harness.closed,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    assert.ok(result, 'teardown continued after the stalled shutdown command timed out');
    assert.equal(result.code, 124);
    const calls = callsFrom(harness.callsPath);
    assert.ok(calls.includes(`simctl delete ${simulatorId}`), calls.join('\n'));
  } finally {
    await stopGroup(harness.child);
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test('preserves Simulator inventory failures after exact cleanup succeeds', async (t) => {
  for (const failedInventory of ['devices', 'booted']) {
    await t.test(`${failedInventory} inventory failure`, async () => {
      const failureStatus = 37;
      // Fail only the selected pre-cleanup inventory; the final listing succeeds after deletion.
      const harness = startFake(
        teardownScript,
        ({ logPath }) => [simulatorId, logPath],
        [
          'if [[ "$*" == "simctl list devices" ]]; then',
          `  if [[ "$FAILED_INVENTORY" == "devices" && ! -f "$DELETED_SIMULATOR_MARKER" ]]; then exit ${failureStatus}; fi`,
          `  if [[ ! -f "$DELETED_SIMULATOR_MARKER" ]]; then printf '%s\\n' '${simulatorId} (Booted)'; fi`,
          'elif [[ "$*" == "simctl list devices booted" ]]; then',
          `  if [[ "$FAILED_INVENTORY" == "booted" ]]; then exit ${failureStatus}; fi`,
          `  printf '%s\\n' '${simulatorId} (Booted)'`,
          `elif [[ "$*" == "simctl shutdown ${simulatorId}" ]]; then`,
          '  exit 0',
          `elif [[ "$*" == "simctl delete ${simulatorId}" ]]; then`,
          '  touch "$DELETED_SIMULATOR_MARKER"',
          'else',
          '  exit 97',
          'fi',
        ].join('\n'),
        { FAILED_INVENTORY: failedInventory },
      );

      try {
        const result = await harness.closed;
        assert.equal(result.code, failureStatus);
        const calls = callsFrom(harness.callsPath);
        assert.ok(calls.includes(`simctl shutdown ${simulatorId}`), calls.join('\n'));
        assert.ok(calls.includes(`simctl delete ${simulatorId}`), calls.join('\n'));
      } finally {
        await stopGroup(harness.child);
        rmSync(harness.directory, { recursive: true, force: true });
      }
    });
  }
});
