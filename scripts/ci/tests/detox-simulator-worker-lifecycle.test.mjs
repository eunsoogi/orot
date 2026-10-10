import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scriptsDirectory = join(repositoryRoot, 'scripts/ci');
const collectScript = join(scriptsDirectory, 'collect-simulator-diagnostics.sh');
const waitScript = join(scriptsDirectory, 'wait-detox-simulator.sh');
const teardownScript = join(scriptsDirectory, 'teardown-detox-simulator.sh');
const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
const deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro';
const base = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
const workerOne = '11111111-2222-4333-8444-555555555555';
const workerTwo = '22222222-3333-4444-8555-666666666666';
const unrelated = 'BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF';

function inventory(ids) {
  return JSON.stringify({
    devices: {
      [runtime]: ids.map((udid) => ({
        udid,
        name: 'iPhone 18 Pro',
        deviceTypeIdentifier: deviceType,
        state: 'Booted',
      })),
    },
  });
}

function runWithFakeXcrun(directory, script, args, implementation, extraEnv = {}) {
  const bin = join(directory, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'xcrun'),
    ['#!/usr/bin/env bash', 'printf \'%s\\n\' "$*" >> "$XCRUN_CALLS"', implementation].join('\n'),
    { mode: 0o755 },
  );
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [bin, process.env.PATH].join(':'),
      XCRUN_CALLS: join(directory, 'xcrun-calls.log'),
      EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: runtime,
      EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: deviceType,
      // Release targets one base by default; shard fixtures include both worker Simulators.
      OROT_DETOX_RELEASE_SHARDING: 'false',
      ...extraEnv,
    },
  });
}

test('captures diagnostics for every Simulator assigned to explicitly sharded Release workers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-worker-diagnostics-'));
  const artifacts = join(directory, 'artifacts');
  const testLog = join(artifacts, 'e2e-test.log');
  const outputLog = join(artifacts, 'simulator.log');
  const identityPath = join(artifacts, 'simulator.udid');
  const baselinePath = join(artifacts, 'simulator-baseline.json');
  const targetPath = join(artifacts, 'simulator-targets.txt');
  try {
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(identityPath, `${base}\n`);
    writeFileSync(baselinePath, inventory([base, unrelated]));
    writeFileSync(
      testLog,
      [
        `release-e2e.test.js is assigned to ${base} (undefined)`,
        `release-e2e-safe-area.test.js is assigned to ${workerTwo} (undefined)`,
        `release-e2e-data.test.js is assigned to ${workerOne} (undefined)`,
      ].join('\n'),
    );
    const result = runWithFakeXcrun(
      directory,
      collectScript,
      [testLog, outputLog, identityPath, 'release', baselinePath, targetPath],
      [
        'if [[ "$*" == "simctl list devices --json" ]]; then',
        `  printf '%s\\n' '${inventory([base, unrelated, workerOne, workerTwo])}'`,
        'elif [[ "$1 $2" == "simctl spawn" ]]; then',
        '  printf "captured %s\\n" "$3"',
        'else',
        '  exit 97',
        'fi',
      ].join('\n'),
      { OROT_DETOX_RELEASE_SHARDING: 'true' },
    );

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(readFileSync(targetPath, 'utf8').trim().split('\n'), [
      base,
      workerOne,
      workerTwo,
    ]);
    assert.match(readFileSync(outputLog, 'utf8'), new RegExp(`captured ${base}`));
    for (const worker of [workerOne, workerTwo]) {
      assert.match(
        readFileSync(join(artifacts, 'simulator-workers', `${worker}.log`), 'utf8'),
        new RegExp(`captured ${worker}`),
      );
    }
    const calls = readFileSync(join(directory, 'xcrun-calls.log'), 'utf8');
    for (const simulator of [base, workerOne, workerTwo]) {
      assert.match(calls, new RegExp(`simctl spawn ${simulator} log show`));
    }
    assert.doesNotMatch(calls, new RegExp(`simctl spawn ${unrelated} log show`));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails closed on an unclassified Simulator in an explicitly sharded Release run', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-worker-drift-'));
  const artifacts = join(directory, 'artifacts');
  const testLog = join(artifacts, 'e2e-test.log');
  const outputLog = join(artifacts, 'simulator.log');
  const identityPath = join(artifacts, 'simulator.udid');
  const baselinePath = join(artifacts, 'simulator-baseline.json');
  const targetPath = join(artifacts, 'simulator-targets.txt');
  const unexpected = '99999999-8888-4777-8666-555555555555';
  const currentInventory = JSON.parse(inventory([base, unrelated, workerOne, workerTwo]));
  currentInventory.devices[runtime].push({
    udid: unexpected,
    deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
  });
  try {
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(identityPath, `${base}\n`);
    writeFileSync(baselinePath, inventory([base, unrelated]));
    writeFileSync(
      testLog,
      [
        `release-e2e.test.js is assigned to ${base} (undefined)`,
        `release-e2e-safe-area.test.js is assigned to ${workerTwo} (undefined)`,
        `release-e2e-data.test.js is assigned to ${workerOne} (undefined)`,
      ].join('\n'),
    );
    const result = runWithFakeXcrun(
      directory,
      collectScript,
      [testLog, outputLog, identityPath, 'release', baselinePath, targetPath],
      [
        'if [[ "$*" == "simctl list devices --json" ]]; then',
        `  printf '%s\\n' '${JSON.stringify(currentInventory)}'`,
        'elif [[ "$1 $2" == "simctl spawn" ]]; then',
        '  printf "captured %s\\n" "$3"',
        'else',
        '  exit 97',
        'fi',
      ].join('\n'),
      { OROT_DETOX_RELEASE_SHARDING: 'true' },
    );

    assert.notEqual(result.status, 0);
    assert.deepEqual(readFileSync(targetPath, 'utf8').trim().split('\n'), [
      base,
      workerOne,
      workerTwo,
    ]);
    const calls = readFileSync(join(directory, 'xcrun-calls.log'), 'utf8');
    assert.doesNotMatch(calls, new RegExp(`simctl spawn ${unexpected}`));
    assert.match(
      readFileSync(join(artifacts, 'simulator-inventory.log'), 'utf8'),
      /does not match the profile runtime/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('captures the booted inventory after the dedicated Simulator is ready', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-worker-baseline-'));
  const baselinePath = join(directory, 'simulator-baseline.json');
  try {
    const result = runWithFakeXcrun(
      directory,
      waitScript,
      [base, baselinePath],
      [
        `if [[ "$*" == "simctl bootstatus ${base} -b" ]]; then`,
        '  exit 0',
        'elif [[ "$*" == "simctl list devices --json" ]]; then',
        `  printf '%s\\n' '${inventory([base, unrelated])}'`,
        'else',
        '  exit 97',
        'fi',
      ].join('\n'),
    );

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(baselinePath, 'utf8'), `${inventory([base, unrelated])}\n`);
    assert.deepEqual(readFileSync(join(directory, 'xcrun-calls.log'), 'utf8').trim().split('\n'), [
      `simctl bootstatus ${base} -b`,
      'simctl list devices --json',
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deletes only the dedicated base and worker Simulators listed for this profile', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-worker-teardown-'));
  const artifacts = join(directory, 'artifacts');
  const logPath = join(artifacts, 'simulator-teardown-details.log');
  const targetsPath = join(artifacts, 'simulator-targets.txt');
  const deleted = join(directory, 'deleted');
  try {
    mkdirSync(artifacts, { recursive: true });
    mkdirSync(deleted, { recursive: true });
    writeFileSync(targetsPath, `${base}\n${workerOne}\n${workerTwo}\n`);
    const result = runWithFakeXcrun(
      directory,
      teardownScript,
      [base, logPath, targetsPath],
      [
        'if [[ "$*" == "simctl list devices" ]]; then',
        `  for id in ${base} ${workerOne} ${workerTwo}; do [[ -f "$DELETED/$id" ]] || printf '%s (Booted)\\n' "$id"; done`,
        `  printf '%s (Shutdown)\\n' '${unrelated}'`,
        'elif [[ "$*" == "simctl list devices booted" ]]; then',
        `  for id in ${base} ${workerOne} ${workerTwo}; do [[ -f "$DELETED/$id" ]] || printf '%s (Booted)\\n' "$id"; done`,
        'elif [[ "$1 $2" == "simctl shutdown" ]]; then',
        '  exit 0',
        'elif [[ "$1 $2" == "simctl delete" ]]; then',
        '  touch "$DELETED/$3"',
        'else',
        '  exit 97',
        'fi',
      ].join('\n'),
      { DELETED: deleted },
    );

    assert.equal(result.status, 0, result.stderr + result.stdout);
    const calls = readFileSync(join(directory, 'xcrun-calls.log'), 'utf8');
    for (const simulator of [base, workerOne, workerTwo]) {
      assert.match(calls, new RegExp(`simctl shutdown ${simulator}`));
      assert.match(calls, new RegExp(`simctl delete ${simulator}`));
    }
    assert.doesNotMatch(calls, new RegExp(`simctl delete ${unrelated}`));
    assert.match(
      readFileSync(logPath, 'utf8'),
      new RegExp(`Deleted dedicated Simulator ${base} and 2 worker Simulators`),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
