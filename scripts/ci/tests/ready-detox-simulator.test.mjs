import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../ready-detox-simulator.sh', import.meta.url));
const udid = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-2';
const deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation';

// Exercise the real wrapper and bounded simctl launcher; only the external host commands are fake.
function runFixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-ready-'));
  const bin = join(directory, 'bin');
  const callsPath = join(directory, 'calls');
  const baseline = join(directory, 'baseline.json');
  const identity = join(directory, 'simulator.udid');
  const device = {
    udid,
    name: 'Orot Detox CI 198-2-123',
    deviceTypeIdentifier: deviceType,
    isAvailable: true,
    state: 'Shutdown',
    ...options.device,
  };
  const inventory = JSON.stringify({ devices: { [options.runtime ?? runtime]: [device] } });
  try {
    mkdirSync(bin);
    writeFileSync(identity, `${options.identity ?? udid}\n`);
    writeFileSync(
      join(bin, 'xcrun'),
      [
        '#!/usr/bin/env bash',
        'printf \'%s\\n\' "$*" >> "$CALLS"',
        'if [[ "$*" == "$FAIL_COMMAND" ]]; then exit 42; fi',
        'if [[ "$*" == "simctl list devices --json" ]]; then printf \'%s\\n\' "$INVENTORY"; fi',
        'exit 0',
      ].join('\n'),
      { mode: 0o755 },
    );
    for (const command of ['vm_stat', 'sysctl']) {
      writeFileSync(join(bin, command), '#!/usr/bin/env bash\nprintf "observed memory\\n"\n', {
        mode: 0o755,
      });
    }
    const result = spawnSync(
      'bash',
      [script, options.profile ?? 'transcription', udid, identity, baseline],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CALLS: callsPath,
          INVENTORY: inventory,
          FAIL_COMMAND: options.failCommand ?? '',
          GITHUB_ACTIONS: 'true',
          GITHUB_RUN_ID: '198',
          GITHUB_RUN_ATTEMPT: '2',
          EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: runtime,
          EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: deviceType,
          ...options.env,
        },
      },
    );
    return {
      result,
      inventory,
      calls: existsSync(callsPath) ? readFileSync(callsPath, 'utf8').trim().split('\n') : [],
      baseline: existsSync(baseline) ? readFileSync(baseline, 'utf8') : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const operations = [
  'simctl list devices --json',
  `simctl boot ${udid}`,
  `simctl bootstatus ${udid} -b`,
  'simctl list devices --json',
];

test("boots only this Actions run's Speech device once and records the final ready inventory", () => {
  const { result, calls, baseline, inventory } = runFixture();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(calls, operations);
  assert.equal(baseline, `${inventory}\n`);
  assert.match(result.stdout, /before-boot[\s\S]*after-boot/);
  assert.match(result.stdout, /observed memory/);
});

for (const profile of ['release', 'openai-provider', 'next-visit-questions']) {
  test(`preserves the existing single boot wait for ${profile}`, () => {
    const { result, calls, baseline, inventory } = runFixture({
      profile,
      env: { GITHUB_ACTIONS: 'false' },
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(calls, [operations[2], operations[3]]);
    assert.equal(baseline, `${inventory}\n`);
  });
}

for (const [label, options, expectedCalls] of [
  ['local device', { env: { GITHUB_ACTIONS: 'false' } }, []],
  ['another recorded identity', { identity: 'BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF' }, []],
  ['another Actions run', { device: { name: 'Orot Detox CI 197-2-123' } }, [operations[0]]],
  ['another device type', { device: { deviceTypeIdentifier: 'other' } }, [operations[0]]],
  ['another runtime', { runtime: 'other' }, [operations[0]]],
  ['an already booted device', { device: { state: 'Booted' } }, [operations[0]]],
  ['an unavailable device', { device: { isAvailable: false } }, [operations[0]]],
]) {
  test(`refuses to boot ${label}`, () => {
    const { result, calls, baseline } = runFixture(options);
    assert.notEqual(result.status, 0);
    assert.deepEqual(calls, expectedCalls);
    assert.equal(baseline, null);
  });
}

for (const index of [1, 2]) {
  test(`stops preparation when ${operations[index]} fails`, () => {
    const { result, calls, baseline } = runFixture({ failCommand: operations[index] });
    assert.notEqual(result.status, 0);
    assert.deepEqual(calls, operations.slice(0, index + 1));
    assert.equal(baseline, null);
  });
}
