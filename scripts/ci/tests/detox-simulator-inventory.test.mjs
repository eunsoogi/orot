import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { planDetoxSimulatorTargets } from '../detox-simulator-inventory.mjs';

const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
const deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro';
const base = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
const cloneOne = '11111111-2222-4333-8444-555555555555';
const cloneTwo = '22222222-3333-4444-8555-666666666666';
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const inventoryScript = join(repositoryRoot, 'scripts/ci/detox-simulator-inventory.mjs');

function inventory(devices) {
  return { devices };
}

function simulator(udid, deviceTypeIdentifier = deviceType) {
  return { udid, name: 'iPhone 18 Pro', deviceTypeIdentifier, state: 'Shutdown' };
}

test('selects the dedicated base for the combined Release run', () => {
  const current = inventory({ [runtime]: [simulator(base)] });
  const result = planDetoxSimulatorTargets({
    baseline: current,
    current,
    baseUdid: base,
    expectedRuntime: runtime,
    expectedDeviceType: deviceType,
    testLog: `release-e2e.test.js is assigned to ${base} (undefined)`,
    expectedWorkers: 1,
  });

  assert.deepEqual(result.targetUdids, [base]);
  assert.deepEqual(result.assignedUdids, [base]);
  assert.deepEqual(result.issues, []);
});

test('selects only new profile-matched Simulators for explicitly sharded workers', () => {
  const baseline = inventory({
    [runtime]: [simulator(base), simulator('BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF')],
  });
  const current = inventory({
    [runtime]: [simulator(base), simulator(cloneOne)],
  });
  const testLog = [
    `[release-e2e.test.js] release-e2e.test.js is assigned to ${base} (undefined)`,
    `[release-e2e-data.test.js] release-e2e-data.test.js is assigned to ${cloneOne} (undefined)`,
  ].join('\n');

  const result = planDetoxSimulatorTargets({
    baseline,
    current,
    baseUdid: base,
    expectedRuntime: runtime,
    expectedDeviceType: deviceType,
    testLog,
    expectedWorkers: 2,
  });

  assert.deepEqual(result.targetUdids, [base, cloneOne]);
  assert.deepEqual(result.assignedUdids, [base, cloneOne]);
  assert.deepEqual(result.issues, []);
});

test('inventory command expects one default Release assignment and two for explicit shards', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-inventory-mode-'));
  const baselinePath = join(directory, 'baseline.json');
  const currentPath = join(directory, 'current.json');
  const testLogPath = join(directory, 'test.log');
  const targetsPath = join(directory, 'targets.txt');
  const env = { ...process.env };
  delete env.OROT_DETOX_RELEASE_SHARDING;
  Object.assign(env, {
    EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: runtime,
    EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: deviceType,
  });

  try {
    writeFileSync(baselinePath, JSON.stringify(inventory({ [runtime]: [simulator(base)] })));
    writeFileSync(currentPath, JSON.stringify(inventory({ [runtime]: [simulator(base)] })));
    writeFileSync(testLogPath, `release-e2e.test.js is assigned to ${base} (undefined)`);
    const combined = spawnSync(
      process.execPath,
      [inventoryScript, baselinePath, currentPath, testLogPath, base, 'release', targetsPath],
      { encoding: 'utf8', env },
    );
    assert.equal(combined.status, 0, combined.stderr);
    assert.match(combined.stdout, /workers=1 targets=1/);
    assert.equal(readFileSync(targetsPath, 'utf8'), `${base}\n`);

    writeFileSync(
      currentPath,
      JSON.stringify(inventory({ [runtime]: [simulator(base), simulator(cloneOne)] })),
    );
    writeFileSync(
      testLogPath,
      [
        `release-e2e.test.js is assigned to ${base} (undefined)`,
        `release-e2e-data.test.js is assigned to ${cloneOne} (undefined)`,
      ].join('\n'),
    );
    const sharded = spawnSync(
      process.execPath,
      [inventoryScript, baselinePath, currentPath, testLogPath, base, 'release', targetsPath],
      { encoding: 'utf8', env: { ...env, OROT_DETOX_RELEASE_SHARDING: 'true' } },
    );
    assert.equal(sharded.status, 0, sharded.stderr);
    assert.match(sharded.stdout, /workers=2 targets=2/);
    assert.deepEqual(readFileSync(targetsPath, 'utf8').trim().split('\n'), [base, cloneOne]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails closed on unexpected new devices and incomplete or shared worker assignments', () => {
  const unexpectedId = '99999999-8888-4777-8666-555555555555';
  const result = planDetoxSimulatorTargets({
    baseline: inventory({ [runtime]: [simulator(base)] }),
    current: inventory({
      [runtime]: [simulator(base), simulator(cloneOne), simulator(cloneTwo)],
      'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [simulator(unexpectedId, deviceType)],
    }),
    baseUdid: base,
    expectedRuntime: runtime,
    expectedDeviceType: deviceType,
    testLog: [
      `release-e2e.test.js is assigned to ${base} (undefined)`,
      `release-e2e-data.test.js is assigned to ${cloneOne} (undefined)`,
    ].join('\n'),
    expectedWorkers: 2,
  });

  assert.deepEqual(result.targetUdids, [base, cloneOne, cloneTwo]);
  assert.ok(result.issues.some((issue) => issue.includes(unexpectedId)));
  const sharedAssignments = planDetoxSimulatorTargets({
    baseline: inventory({ [runtime]: [simulator(base)] }),
    current: inventory({ [runtime]: [simulator(base), simulator(cloneOne)] }),
    baseUdid: base,
    expectedRuntime: runtime,
    expectedDeviceType: deviceType,
    testLog: [
      `release-e2e.test.js is assigned to ${base} (undefined)`,
      `release-e2e-data.test.js is assigned to ${base} (undefined)`,
    ].join('\n'),
    expectedWorkers: 2,
  });
  assert.ok(
    sharedAssignments.issues.some((issue) =>
      issue.includes('expected 2 distinct worker assignments, received 1'),
    ),
  );
});
