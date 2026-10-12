import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeTestConfig } from './native-test-config.mjs';

function simctl(...args) {
  return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' }).trim();
}
function inventory(owner) {
  const devices = JSON.parse(simctl('list', 'devices', '-j')).devices;
  const device = devices[owner.runtime]?.find((item) => item.udid === owner.udid);
  if (!device || device.name !== owner.name || device.deviceTypeIdentifier !== owner.device)
    throw new Error('Native simulator ownership mismatch');
  return device;
}

export function verifyNativeSimulator(owner, profile) {
  const config = nativeTestConfig(profile);
  if (
    owner.profile !== profile ||
    owner.runtime !== config.runtime ||
    owner.device !== config.device
  )
    throw new Error('Native simulator execution contract mismatch');
  const runtime = JSON.parse(simctl('list', 'runtimes', '-j')).runtimes.find(
    (item) => item.identifier === config.runtime && item.isAvailable,
  );
  if (!runtime || (config.runtimeBuild && runtime.buildversion !== config.runtimeBuild))
    throw new Error('Approved native test runtime is unavailable');
  return inventory(owner);
}

const [command, profile, path] = process.argv.slice(2);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!path)
    throw new Error(
      'Usage: native-test-simulator.mjs <prepare|verify|cleanup> <profile> <owner-file>',
    );
  const ownerPath = resolve(path);
  if (command === 'prepare') {
    if (existsSync(ownerPath)) throw new Error('Native simulator ownership file already exists');
    const config = nativeTestConfig(profile);
    const name = `OrotNative-${profile}-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
    const owner = { profile, runtime: config.runtime, device: config.device, name };
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
      throw new Error('Approved native test runtime is unavailable');
    owner.udid = simctl('create', name, config.device, config.runtime);
    writeFileSync(ownerPath, JSON.stringify(owner, null, 2) + '\n');
    verifyNativeSimulator(owner, profile);
    simctl('boot', owner.udid);
    simctl('bootstatus', owner.udid, '-b');
    if (process.env.GITHUB_ENV)
      writeFileSync(process.env.GITHUB_ENV, `OROT_NATIVE_SIMULATOR_UDID=${owner.udid}\n`, {
        flag: 'a',
      });
    console.log(JSON.stringify(owner));
  } else {
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
    const device = verifyNativeSimulator(owner, profile);
    if (command === 'verify') {
      if (device.state !== 'Booted') throw new Error('Owned native test simulator is not booted');
      console.log(owner.udid);
    } else if (command === 'cleanup') {
      // Cleanup is confined to the recorded device, including on test failure. Other lanes are preserved.
      if (device.state === 'Booted') simctl('shutdown', owner.udid);
      simctl('delete', owner.udid);
    } else throw new Error('Unknown native simulator command');
  }
}
