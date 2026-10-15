import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iosTestConfig } from './ios-test-config.mjs';
import { iosTestCohort, verifyIosSimulatorOwnerContract } from './ios-test-cohorts.mjs';
import { iosTestResourceSampler } from './ios-test-resources.mjs';

/** Preserve command failures and stdout while reporting each public simctl operation separately on stderr. */
export function runIosSimulatorCommand(args, options = {}) {
  const started = performance.now();
  const operation = { operation: 'simctl', arguments: args, timestamp: new Date().toISOString() };
  console.error(JSON.stringify({ ...operation, phase: 'started' }));
  let failure;
  try {
    return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', ...options });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    console.error(
      JSON.stringify({
        ...operation,
        phase: 'finished',
        timestamp: new Date().toISOString(),
        elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
        status: failure ? (failure.status ?? null) : 0,
        signal: failure?.signal ?? null,
        errorCode: failure?.code ?? null,
      }),
    );
  }
}
function simctl(...args) {
  return runIosSimulatorCommand(args).trim();
}

/** Keep Apple's migration/readiness progress visible while sampling the wait. No boot retry or service mutation is performed. */
async function bootOwnedSimulator(owner, ownerPath) {
  const stopSampling = iosTestResourceSampler(ownerPath + '.boot.resources.jsonl');
  try {
    simctl('boot', owner.udid);
    const args = ['bootstatus', owner.udid, '-b'];
    const operation = { operation: 'simctl', arguments: args };
    const started = performance.now();
    console.error(
      JSON.stringify({ ...operation, timestamp: new Date().toISOString(), phase: 'started' }),
    );
    // execFileSync previously discarded this stdout, hiding whether a long wait was migration or readiness.
    const command = spawn('xcrun', ['simctl', ...args], { stdio: 'inherit' });
    const outcome = await new Promise((accept, reject) => {
      command.once('error', reject);
      command.once('close', (status, signal) => accept({ status, signal }));
    });
    console.error(
      JSON.stringify({
        ...operation,
        timestamp: new Date().toISOString(),
        phase: 'finished',
        elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
        ...outcome,
      }),
    );
    if (outcome.status !== 0 || outcome.signal)
      throw new Error(`iOS bootstatus failed: ${outcome.signal ?? outcome.status}`);
  } finally {
    stopSampling();
  }
}
function inventory(owner, devices) {
  const device = devices[owner.runtime]?.find((item) => item.udid === owner.udid);
  if (!device || device.name !== owner.name || device.deviceTypeIdentifier !== owner.device)
    throw new Error('iOS simulator ownership mismatch');
  return device;
}

export function verifyIosTestSimulator(owner, profile) {
  const config = verifyIosSimulatorOwnerContract(owner, profile);
  // One fresh public inventory contains both boundaries. Never cache it across mutations.
  const snapshot = JSON.parse(simctl('list', '-j'));
  const runtime = snapshot.runtimes.find(
    (item) => item.identifier === config.runtime && item.isAvailable,
  );
  if (!runtime || (config.runtimeBuild && runtime.buildversion !== config.runtimeBuild))
    throw new Error('Approved integration test runtime is unavailable');
  return inventory(owner, snapshot.devices);
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
    if (
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.RUNNER_ENVIRONMENT === 'github-hosted'
    ) {
      // Apple documents this public command as the readiness barrier for runtime caches.
      // Complete the selected cache before boot so its compiler cannot compete with the new Simulator.
      // Never force regeneration, touch another runtime, or change a local/self-hosted machine.
      const stopSampling = iosTestResourceSampler(ownerPath + '.runtime.resources.jsonl');
      try {
        runIosSimulatorCommand(['runtime', 'dyld_shared_cache', 'update', config.runtime], {
          stdio: 'inherit',
        });
      } finally {
        stopSampling();
      }
    }
    owner.udid = simctl('create', name, config.device, config.runtime);
    writeFileSync(ownerPath, JSON.stringify(owner, null, 2) + '\n');
    verifyIosTestSimulator(owner, cohort?.profiles[0] ?? profile);
    await bootOwnedSimulator(owner, ownerPath);
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
