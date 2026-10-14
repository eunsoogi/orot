import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iosTestConfig } from './ios-test-config.mjs';
import { iosTestCohort, verifyIosSimulatorOwnerContract } from './ios-test-cohorts.mjs';

function simctl(...args) {
  return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' }).trim();
}
function inventory(owner) {
  const devices = JSON.parse(simctl('list', 'devices', '-j')).devices;
  const device = devices[owner.runtime]?.find((item) => item.udid === owner.udid);
  if (!device || device.name !== owner.name || device.deviceTypeIdentifier !== owner.device)
    throw new Error('iOS simulator ownership mismatch');
  return device;
}

export function verifyIosTestSimulator(owner, profile) {
  const config = verifyIosSimulatorOwnerContract(owner, profile);
  const runtime = JSON.parse(simctl('list', 'runtimes', '-j')).runtimes.find(
    (item) => item.identifier === config.runtime && item.isAvailable,
  );
  if (!runtime || (config.runtimeBuild && runtime.buildversion !== config.runtimeBuild))
    throw new Error('Approved integration test runtime is unavailable');
  return inventory(owner);
}

const [command, profile, path] = process.argv.slice(2);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!path)
    throw new Error(
      'Usage: ios-test-simulator.mjs <prepare|verify|cleanup> <profile> <owner-file>',
    );
  const ownerPath = resolve(path);
  if (command === 'prepare' || command === 'prepare-cohort') {
    if (existsSync(ownerPath)) throw new Error('iOS simulator ownership file already exists');
    const cohort = command === 'prepare-cohort' ? iosTestCohort(profile) : null;
    const config = cohort?.config ?? iosTestConfig(profile);
    const name = `OrotTests-${cohort ? 'cohort-' : ''}${profile}-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
    const owner = {
      ...(cohort ? { cohort: profile, profiles: cohort.profiles } : { profile }),
      runtime: config.runtime,
      device: config.device,
      name,
    };
    // Fail before creation if the approved runtime is missing; never substitute another runtime.
    const runtimes = JSON.parse(simctl('list', 'runtimes', '-j')).runtimes;
    if (
      !runtimes.some(
        (item) =>
          item.identifier === config.runtime &&
          item.isAvailable &&
          (!config.runtimeBuild || item.buildversion === config.runtimeBuild),
      )
    )
      throw new Error('Approved integration test runtime is unavailable');
    owner.udid = simctl('create', name, config.device, config.runtime);
    writeFileSync(ownerPath, JSON.stringify(owner, null, 2) + '\n');
    verifyIosTestSimulator(owner, cohort?.profiles[0] ?? profile);
    simctl('boot', owner.udid);
    simctl('bootstatus', owner.udid, '-b');
    if (process.env.GITHUB_ENV)
      writeFileSync(process.env.GITHUB_ENV, `OROT_IOS_TEST_SIMULATOR_UDID=${owner.udid}\n`, {
        flag: 'a',
      });
    console.log(JSON.stringify(owner));
  } else {
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
    const executionProfile = owner.cohort ? iosTestCohort(profile).profiles[0] : profile;
    if (owner.cohort && owner.cohort !== profile)
      throw new Error('iOS cohort cleanup identity mismatch');
    const device = verifyIosTestSimulator(owner, executionProfile);
    if (command === 'verify' || command === 'verify-cohort') {
      if (device.state !== 'Booted')
        throw new Error('Owned integration test simulator is not booted');
      console.log(owner.udid);
    } else if (command === 'cleanup') {
      // Cleanup is confined to the recorded device, including on test failure. Other lanes are preserved.
      if (device.state === 'Booted') simctl('shutdown', owner.udid);
      simctl('delete', owner.udid);
    } else throw new Error('Unknown integration simulator command');
  }
}
