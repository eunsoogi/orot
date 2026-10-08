#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
const releaseShards = requireFromRepository('./apps/mobile/e2e/release-e2e-shards.js');
const simulatorVariables = {
  'release-e2e.test.js': 'OROT_DETOX_SIMULATOR_UDID',
  'release-e2e-data.test.js': 'OROT_DETOX_RELEASE_DATA_SIMULATOR_UDID',
  'release-e2e-storage.test.js': 'OROT_DETOX_RELEASE_STORAGE_SIMULATOR_UDID',
};
const simulatorPattern = /^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/;
// Detox output may contain terminal styling codes; remove them before reading Jest summary lines.
// eslint-disable-next-line no-control-regex
const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const terminationGraceMs = 1000;

function readShards() {
  const assignments = Object.keys(releaseShards).map((wrapper) => {
    const variable = simulatorVariables[wrapper];
    const value = process.env[variable];
    if (!value || !simulatorPattern.test(value)) {
      throw new Error(`${variable} must contain a valid dedicated Simulator UDID`);
    }
    return { wrapper, simulatorId: value.toUpperCase() };
  });
  if (assignments.length !== Object.keys(simulatorVariables).length) {
    throw new Error('Release shard manifest and Simulator assignments do not match');
  }
  if (new Set(assignments.map(({ simulatorId }) => simulatorId)).size !== assignments.length) {
    throw new Error('Each Release shard must use a distinct dedicated Simulator');
  }
  if (!process.env.DETOX_ARTIFACTS_LOCATION) {
    throw new Error('DETOX_ARTIFACTS_LOCATION is required');
  }
  const logLevel = process.env.OROT_DETOX_TEST_LOG_LEVEL || 'info';
  if (!['fatal', 'error', 'warn', 'info', 'verbose', 'debug', 'trace'].includes(logLevel)) {
    throw new Error(`Unsupported Detox log level: ${logLevel}`);
  }
  return { assignments, logLevel };
}

function signalGroup(state, signal) {
  if (!state.child.pid) return false;
  if (process.platform !== 'win32') {
    try {
      process.kill(-state.child.pid, signal);
      return true;
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  try {
    return state.child.kill(signal);
  } catch {
    return false;
  }
}

function stopGroup(state) {
  if (state.closed || state.terminationTimer) return;
  signalGroup(state, 'SIGTERM');
  state.terminationTimer = setTimeout(() => {
    signalGroup(state, 'SIGKILL');
    state.child.stdout?.destroy();
    state.child.stderr?.destroy();
  }, terminationGraceMs);
}

function consumeOutput(state, stream, destination) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const plain = line.replace(ansiPattern, '');
    if (destination === 'stdout' && /^(?:Test Suites|Tests):/.test(plain)) {
      state.summaryLines.push(plain);
    }
    process[destination].write(`[${state.wrapper}] ${line}\n`);
  });
}

function launchShard({ wrapper, simulatorId, logLevel }, onFailure) {
  const artifactName = wrapper.replace(/\.test\.js$/, '');
  const artifactPath = join(process.env.DETOX_ARTIFACTS_LOCATION, 'release', artifactName);
  mkdirSync(artifactPath, { recursive: true });
  const state = {
    wrapper,
    simulatorId,
    summaryLines: [],
    exitCode: null,
    signal: null,
    started: performance.now(),
    closed: false,
    terminationTimer: null,
  };
  const args = [
    '--filter',
    '@orot/mobile',
    'exec',
    '--',
    'detox',
    'test',
    '--config-path',
    '../../scripts/ci/detox-e2e-profile.detox.config.cjs',
    '--configuration',
    'ios.sim.release',
    '--loglevel',
    logLevel,
    '--artifacts-location',
    artifactPath,
  ];
  const childEnv = {
    ...process.env,
    DETOX_ARTIFACTS_LOCATION: artifactPath,
    OROT_DETOX_TEST_PROFILE: 'release',
    OROT_DETOX_RELEASE_SHARD: wrapper,
    OROT_DETOX_SIMULATOR_UDID: simulatorId,
  };
  process.stdout.write(
    `DETOX_RELEASE_SHARD_START shard=${wrapper} simulator=${simulatorId} utc=${new Date().toISOString()}\n`,
  );
  state.child = spawn('pnpm', args, {
    cwd: repositoryRoot,
    detached: process.platform !== 'win32',
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  consumeOutput(state, state.child.stdout, 'stdout');
  consumeOutput(state, state.child.stderr, 'stderr');
  state.promise = new Promise((resolve) => {
    state.child.once('error', (error) => {
      state.exitCode = 127;
      process.stderr.write(`[${wrapper}] Detox shard could not start: ${error.message}\n`);
      onFailure(state);
      stopGroup(state);
    });
    state.child.once('exit', (code, signal) => {
      state.exitCode ??= code ?? 128;
      state.signal = signal;
      // A Detox CLI may exit before its Jest worker descendants release the tee pipeline.
      stopGroup(state);
      if (state.exitCode !== 0) onFailure(state);
    });
    state.child.once('close', (code, signal) => {
      state.closed = true;
      state.exitCode ??= code ?? 128;
      state.signal ??= signal;
      clearTimeout(state.terminationTimer);
      const elapsedMs = Math.round(performance.now() - state.started);
      process.stdout.write(
        `DETOX_RELEASE_SHARD_END shard=${wrapper} simulator=${simulatorId} status=${state.exitCode} elapsed_ms=${elapsedMs} utc=${new Date().toISOString()}\n`,
      );
      resolve(state);
    });
  });
  return state;
}

function printSummaries(states) {
  for (const state of states) {
    process.stdout.write(`DETOX_RELEASE_SHARD_SUMMARY_START shard=${state.wrapper}\n`);
    for (const line of state.summaryLines) process.stdout.write(`${line}\n`);
    process.stdout.write(`DETOX_RELEASE_SHARD_SUMMARY_END shard=${state.wrapper}\n`);
  }
}

async function run() {
  const { assignments, logLevel } = readShards();
  const states = [];
  let failed = false;
  const stopSiblings = (failedState) => {
    failed = true;
    for (const state of states) {
      if (state !== failedState && state.exitCode === null) stopGroup(state);
    }
  };
  for (const assignment of assignments) {
    states.push(launchShard({ ...assignment, logLevel }, stopSiblings));
  }

  let receivedSignal = null;
  const interrupt = (signal) => {
    receivedSignal = signal;
    failed = true;
    for (const state of states) stopGroup(state);
  };
  process.once('SIGINT', () => interrupt('SIGINT'));
  process.once('SIGTERM', () => interrupt('SIGTERM'));
  process.once('SIGHUP', () => interrupt('SIGHUP'));

  const completed = await Promise.all(states.map((state) => state.promise));
  printSummaries(completed);
  if (receivedSignal)
    return receivedSignal === 'SIGINT' ? 130 : receivedSignal === 'SIGHUP' ? 129 : 143;
  return failed || completed.some((state) => state.exitCode !== 0) ? 1 : 0;
}

run()
  .then((status) => {
    process.exitCode = status;
  })
  .catch((error) => {
    console.error(`Release shard preflight failed: ${error.message}`);
    process.exitCode = 2;
  });
