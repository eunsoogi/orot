import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const udidPattern = /^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/;

function readInventory(value, label) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.devices ||
    typeof parsed.devices !== 'object'
  ) {
    throw new Error(`${label} Simulator inventory must contain a devices map`);
  }

  const devices = new Map();
  for (const [runtimeIdentifier, runtimeDevices] of Object.entries(parsed.devices)) {
    if (!Array.isArray(runtimeDevices)) {
      throw new Error(`${label} Simulator runtime ${runtimeIdentifier} must contain a device list`);
    }
    for (const device of runtimeDevices) {
      if (!device || typeof device.udid !== 'string' || !udidPattern.test(device.udid)) {
        throw new Error(`${label} Simulator inventory contains an invalid UDID`);
      }
      const udid = device.udid.toUpperCase();
      if (devices.has(udid)) {
        throw new Error(`${label} Simulator inventory repeats UDID ${udid}`);
      }
      devices.set(udid, {
        udid,
        runtimeIdentifier,
        deviceTypeIdentifier: device.deviceTypeIdentifier ?? null,
      });
    }
  }
  return devices;
}

function assignedSimulatorIds(testLog) {
  const ids = [];
  // Sharded Detox output prefixes worker lines; match the assignment inside that prefix.
  const assignment = /\b[\w.-]+\.js is assigned to ([A-Fa-f0-9-]{36})\b/g;
  for (const match of testLog.matchAll(assignment)) ids.push(match[1].toUpperCase());
  return ids;
}

export function planDetoxSimulatorTargets({
  baseline,
  current,
  baseUdid,
  expectedRuntime,
  expectedDeviceType,
  testLog,
  expectedWorkers,
}) {
  if (!udidPattern.test(baseUdid ?? '')) throw new Error('Base Simulator UDID is invalid');
  baseUdid = baseUdid.toUpperCase();
  if (!expectedRuntime || !expectedDeviceType) {
    throw new Error('Expected Simulator runtime and device type are required');
  }
  if (!Number.isInteger(expectedWorkers) || expectedWorkers < 1) {
    throw new Error('Expected Detox worker count must be a positive integer');
  }

  const baselineDevices = readInventory(baseline, 'Baseline');
  const currentDevices = readInventory(current, 'Current');
  const issues = [];
  const baseBefore = baselineDevices.get(baseUdid);
  const baseAfter = currentDevices.get(baseUdid);
  if (!baseBefore) issues.push(`Dedicated base Simulator ${baseUdid} is absent from the baseline`);
  if (!baseAfter) issues.push(`Dedicated base Simulator ${baseUdid} is absent after Detox`);
  for (const baseDevice of [baseBefore, baseAfter].filter(Boolean)) {
    if (
      baseDevice.runtimeIdentifier !== expectedRuntime ||
      baseDevice.deviceTypeIdentifier !== expectedDeviceType
    ) {
      issues.push(
        `Dedicated base Simulator ${baseUdid} does not match the profile runtime and device type`,
      );
    }
  }

  // Only devices created after the dedicated base was captured and matching this profile may be cleaned up.
  const targetUdids = [baseUdid];
  const newDevices = [...currentDevices.values()]
    .filter((device) => !baselineDevices.has(device.udid))
    .sort((left, right) => left.udid.localeCompare(right.udid));
  for (const device of newDevices) {
    if (
      device.runtimeIdentifier === expectedRuntime &&
      device.deviceTypeIdentifier === expectedDeviceType
    ) {
      targetUdids.push(device.udid);
    } else {
      issues.push(
        `New Simulator ${device.udid} does not match the profile runtime and device type`,
      );
    }
  }

  const assignedUdids = assignedSimulatorIds(testLog ?? '');
  const uniqueAssignments = [...new Set(assignedUdids)];
  if (uniqueAssignments.length !== expectedWorkers) {
    issues.push(
      `Detox expected ${expectedWorkers} distinct worker assignments, received ${uniqueAssignments.length}`,
    );
  }
  for (const udid of uniqueAssignments) {
    if (!currentDevices.has(udid)) {
      issues.push(`Detox assigned a Simulator missing from the current inventory: ${udid}`);
    } else if (!targetUdids.includes(udid)) {
      issues.push(`Detox assigned a Simulator outside the dedicated profile inventory: ${udid}`);
    }
  }

  return { targetUdids, assignedUdids: uniqueAssignments, issues };
}

function main() {
  const [baselinePath, currentPath, testLogPath, baseUdid, profile, targetsPath] =
    process.argv.slice(2);
  const profileWorkers = { release: 2, 'openai-provider': 1, transcription: 1 };
  if (
    !baselinePath ||
    !currentPath ||
    !testLogPath ||
    !baseUdid ||
    !profileWorkers[profile] ||
    !targetsPath
  ) {
    throw new Error(
      'Usage: detox-simulator-inventory.mjs <baseline-json> <current-json> <test-log> <base-udid> <release|openai-provider|transcription> <targets-path>',
    );
  }
  mkdirSync(dirname(targetsPath), { recursive: true });
  if (udidPattern.test(baseUdid))
    writeFileSync(targetsPath, `${baseUdid.toUpperCase()}\n`, { mode: 0o600 });

  const plan = planDetoxSimulatorTargets({
    baseline: readFileSync(baselinePath, 'utf8'),
    current: readFileSync(currentPath, 'utf8'),
    baseUdid: baseUdid.toUpperCase(),
    expectedRuntime: process.env.EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER,
    expectedDeviceType: process.env.EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID,
    testLog: existsSync(testLogPath) ? readFileSync(testLogPath, 'utf8') : '',
    expectedWorkers: profileWorkers[profile],
  });

  writeFileSync(targetsPath, `${plan.targetUdids.join('\n')}\n`, { mode: 0o600 });
  console.log(
    `DETOX_SIMULATOR_INVENTORY profile=${profile} workers=${plan.assignedUdids.length} targets=${plan.targetUdids.length}`,
  );
  for (const issue of plan.issues) console.error(`DETOX_SIMULATOR_INVENTORY_ERROR ${issue}`);
  if (plan.issues.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`DETOX_SIMULATOR_INVENTORY_ERROR ${error.message}`);
    process.exitCode = 1;
  }
}
