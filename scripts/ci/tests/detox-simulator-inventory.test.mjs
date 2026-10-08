import assert from 'node:assert/strict';
import test from 'node:test';
import { planDetoxSimulatorTargets } from '../detox-simulator-inventory.mjs';

const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
const deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro';
const base = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
const cloneOne = '11111111-2222-4333-8444-555555555555';
const cloneTwo = '66666666-7777-4888-8999-AAAAAAAAAAAA';

function inventory(devices) {
  return { devices };
}

function simulator(udid, deviceTypeIdentifier = deviceType) {
  return { udid, name: 'iPhone 18 Pro', deviceTypeIdentifier, state: 'Shutdown' };
}

test('selects only new profile-matched worker Simulators and verifies unique assignments', () => {
  const baseline = inventory({
    [runtime]: [simulator(base), simulator('BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF')],
  });
  const current = inventory({
    [runtime]: [simulator(base), simulator(cloneOne), simulator(cloneTwo)],
  });
  const testLog = [
    `release-e2e.test.js is assigned to ${base} (undefined)`,
    `release-e2e-data.test.js is assigned to ${cloneOne} (undefined)`,
    `release-e2e-storage.test.js is assigned to ${cloneTwo} (undefined)`,
  ].join('\n');

  const result = planDetoxSimulatorTargets({
    baseline,
    current,
    baseUdid: base,
    expectedRuntime: runtime,
    expectedDeviceType: deviceType,
    testLog,
    expectedWorkers: 3,
  });

  assert.deepEqual(result.targetUdids, [base, cloneOne, cloneTwo]);
  assert.deepEqual(result.assignedUdids, [base, cloneOne, cloneTwo]);
  assert.deepEqual(result.issues, []);
});

test('fails closed on unexpected new devices and incomplete or shared worker assignments', () => {
  const unexpectedId = '99999999-8888-4777-8666-555555555555';
  const result = planDetoxSimulatorTargets({
    baseline: inventory({ [runtime]: [simulator(base)] }),
    current: inventory({
      [runtime]: [simulator(base), simulator(cloneOne)],
      'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [simulator(unexpectedId, deviceType)],
    }),
    baseUdid: base,
    expectedRuntime: runtime,
    expectedDeviceType: deviceType,
    testLog: `release-e2e.test.js is assigned to ${base} (undefined)\nrelease-e2e-data.test.js is assigned to ${base} (undefined)`,
    expectedWorkers: 3,
  });

  assert.deepEqual(result.targetUdids, [base, cloneOne]);
  assert.ok(result.issues.some((issue) => issue.includes(unexpectedId)));
  assert.ok(
    result.issues.some((issue) => issue.includes('expected 3 distinct worker assignments')),
  );
});
