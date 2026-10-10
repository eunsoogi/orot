import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const prepareScript = join(repositoryRoot, 'scripts/ci/prepare-detox-release-worker-simulators.sh');
const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
const deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro';
const baseId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
const dataId = '11111111-2222-4333-8444-555555555555';

function fixture(failBoot = false) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-worker-simulators-'));
  const bin = join(directory, 'bin');
  const callsPath = join(directory, 'simctl-calls.log');
  const timeoutsPath = join(directory, 'simctl-timeouts.log');
  const environmentPath = join(directory, 'github-env');
  const simulatorIdsPath = join(directory, 'release-worker-simulators.txt');
  const baseStatePath = join(directory, 'base-simulator-state');
  mkdirSync(bin, { recursive: true });
  writeFileSync(environmentPath, '');
  // The preceding profile setup has already booted the base before Release workers are prepared.
  writeFileSync(baseStatePath, 'Booted\n');
  writeFileSync(
    join(bin, 'xcrun'),
    // Keep clone ancestry and labels visible without creating real host Simulators.
    `#!/bin/sh
printf '%s\\n' "$*" >>"$SIMCTL_CALLS"
if [ "$2" = shutdown ] && [ "$3" = "$BASE_SIMULATOR_UDID" ]; then
  echo Shutdown >"$BASE_SIMULATOR_STATE"
elif [ "$2" = clone ]; then
  if [ "$(cat "$BASE_SIMULATOR_STATE")" = Booted ]; then
    echo 'Unable to clone device in current state: Booted' >&2
    exit 45
  fi
  case "$4" in
    *"Release data") printf '%s\\n' "$DATA_SIMULATOR_UDID" ;;
    *) exit 98 ;;
  esac
elif [ "$2" = boot ]; then
  if [ -n "$FAIL_BOOT_UDID" ] && [ "$3" = "$FAIL_BOOT_UDID" ]; then exit 23; fi
  if [ "$3" = "$BASE_SIMULATOR_UDID" ]; then echo Booted >"$BASE_SIMULATOR_STATE"; fi
fi
`,
    { mode: 0o755 },
  );
  // Observe the timeout passed by run-detox-simctl while keeping simulator calls hermetic.
  writeFileSync(
    join(bin, 'node'),
    `#!/bin/sh
printf '%s\\n' "$2" >>"$SIMCTL_TIMEOUTS"
shift 2
exec xcrun simctl "$@"
`,
    { mode: 0o755 },
  );
  return {
    directory,
    callsPath,
    timeoutsPath,
    environmentPath,
    simulatorIdsPath,
    env: {
      ...process.env,
      PATH: [bin, process.env.PATH].join(':'),
      SIMCTL_CALLS: callsPath,
      SIMCTL_TIMEOUTS: timeoutsPath,
      BASE_SIMULATOR_STATE: baseStatePath,
      BASE_SIMULATOR_UDID: baseId,
      // Force the shell default even when the developer process has an override.
      OROT_DETOX_SIMCTL_TIMEOUT_MS: '',
      DATA_SIMULATOR_UDID: dataId,
      OROT_DETOX_SIMULATOR_UDID: baseId,
      EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: runtime,
      EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: deviceType,
      GITHUB_ENV: environmentPath,
      GITHUB_RUN_ID: '700',
      GITHUB_RUN_ATTEMPT: '2',
      FAIL_BOOT_UDID: typeof failBoot === 'string' ? failBoot : failBoot ? dataId : '',
    },
  };
}

function runPrepare(context) {
  return spawnSync(
    'bash',
    [prepareScript, join(context.directory, 'prepare.log'), context.simulatorIdsPath],
    { cwd: repositoryRoot, encoding: 'utf8', env: context.env, timeout: 10000 },
  );
}

test('shuts down the prepared base before cloning, then boots the base and data worker', () => {
  const context = fixture();
  try {
    const result = runPrepare(context);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(readFileSync(context.simulatorIdsPath, 'utf8').trim().split('\n'), [dataId]);
    const environment = readFileSync(context.environmentPath, 'utf8');
    assert.match(environment, new RegExp(`OROT_DETOX_RELEASE_DATA_SIMULATOR_UDID=${dataId}`));
    assert.doesNotMatch(environment, /OROT_DETOX_RELEASE_SAFE_AREA_SIMULATOR_UDID/);
    assert.match(environment, /OROT_DETOX_RELEASE_SHARDING=true/);
    const calls = readFileSync(context.callsPath, 'utf8');
    for (const udid of [baseId, dataId]) {
      if (udid !== baseId) assert.match(calls, new RegExp(`simctl clone ${baseId}`));
      assert.match(calls, new RegExp(`simctl boot ${udid}`));
      assert.match(calls, new RegExp(`simctl bootstatus ${udid} -b`));
    }
    assert.doesNotMatch(calls, /simctl create/);
    assert.deepEqual(readFileSync(context.timeoutsPath, 'utf8').trim().split('\n'), [
      '900000',
      '900000',
      '900000',
      '900000',
      '900000',
      '900000',
    ]);
    assert.ok(calls.indexOf(`simctl shutdown ${baseId}`) < calls.indexOf(`simctl clone ${baseId}`));
    assert.ok(calls.lastIndexOf('simctl clone') < calls.indexOf(`simctl boot ${baseId}`));
    assert.equal(readFileSync(context.env.BASE_SIMULATOR_STATE, 'utf8'), 'Booted\n');
  } finally {
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('retains both worker identities when a Simulator boot fails', () => {
  const context = fixture(true);
  try {
    const result = runPrepare(context);
    assert.notEqual(result.status, 0);
    assert.deepEqual(readFileSync(context.simulatorIdsPath, 'utf8').trim().split('\n'), [dataId]);
    const environment = readFileSync(context.environmentPath, 'utf8');
    assert.match(environment, new RegExp(`OROT_DETOX_RELEASE_DATA_SIMULATOR_UDID=${dataId}`));
    assert.doesNotMatch(environment, /OROT_DETOX_RELEASE_SAFE_AREA_SIMULATOR_UDID/);
    assert.doesNotMatch(environment, /OROT_DETOX_RELEASE_SHARDING=true/);
  } finally {
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('records the data clone identity before its worker boot failure', () => {
  const context = fixture(dataId);
  try {
    const result = runPrepare(context);
    assert.notEqual(result.status, 0);
    assert.deepEqual(readFileSync(context.simulatorIdsPath, 'utf8').trim().split('\n'), [dataId]);
    assert.doesNotMatch(
      readFileSync(context.environmentPath, 'utf8'),
      /OROT_DETOX_RELEASE_SHARDING=true/,
    );
  } finally {
    rmSync(context.directory, { recursive: true, force: true });
  }
});
