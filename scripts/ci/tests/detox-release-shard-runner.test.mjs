import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const shardRunner = join(repositoryRoot, 'scripts/ci/run-detox-release-shards.mjs');
const profileRunner = join(repositoryRoot, 'scripts/ci/run-detox-e2e.sh');
const shards = [
  ['release-e2e.test.js', 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE', 3],
  ['release-e2e-safe-area.test.js', '22222222-3333-4444-8555-666666666666', 4],
  ['release-e2e-data.test.js', '11111111-2222-4333-8444-555555555555', 6],
];

function makeFixture(directory, failingShard = '') {
  const bin = join(directory, 'bin');
  const artifactRoot = join(directory, 'detox');
  const callsPath = join(directory, 'calls.log');
  const pidsPath = join(directory, 'process-groups.log');
  const heartbeatPath = join(directory, 'orphan-heartbeat.log');
  const orphanPidPath = join(directory, 'orphan.pid');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/usr/bin/env node
const { appendFileSync, existsSync, writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const shard = process.env.OROT_DETOX_RELEASE_SHARD;
const simulator = process.env.OROT_DETOX_SIMULATOR_UDID;
const counts = {
  'release-e2e.test.js': 3,
  'release-e2e-safe-area.test.js': 4,
  'release-e2e-data.test.js': 6,
};
appendFileSync(process.env.CALLS_PATH, shard + '\\t' + simulator + '\\n');
appendFileSync(process.env.PIDS_PATH, String(process.pid) + '\\n');
if (shard === process.env.FAIL_SHARD) {
  const orphanCode = "process.on('SIGTERM', () => {}); const fs = require('node:fs'); fs.appendFileSync(process.env.HEARTBEAT_PATH, 'tick'); setInterval(() => fs.appendFileSync(process.env.HEARTBEAT_PATH, 'tick'), 20);";
  const orphan = spawn(process.execPath, ['-e', orphanCode], { stdio: 'inherit' });
  writeFileSync(process.env.ORPHAN_PID_PATH, String(orphan.pid));
  appendFileSync(process.env.PIDS_PATH, String(orphan.pid) + '\\n');
  const fallback = setTimeout(() => process.exit(17), 3000);
  const readiness = setInterval(() => {
    if (existsSync(process.env.HEARTBEAT_PATH)) {
      clearInterval(readiness);
      clearTimeout(fallback);
      setTimeout(() => process.exit(17), 75);
    }
  }, 10);
} else {
  console.log(shard + ' is assigned to ' + simulator + ' (undefined)');
  console.log('Test Suites: 1 passed, 1 total');
  console.log('Tests: ' + counts[shard] + ' passed, ' + counts[shard] + ' total');
}
`,
    { mode: 0o755 },
  );

  return {
    artifactRoot,
    callsPath,
    pidsPath,
    heartbeatPath,
    orphanPidPath,
    env: {
      ...process.env,
      // Shard shell fixtures inject a portable timer even when the outer test suite runs in GitHub Actions.
      GITHUB_ACTIONS: 'false',
      PATH: [bin, process.env.PATH].join(':'),
      DETOX_ARTIFACTS_LOCATION: artifactRoot,
      OROT_DETOX_SIMULATOR_UDID: shards[0][1],
      OROT_DETOX_RELEASE_SAFE_AREA_SIMULATOR_UDID: shards[1][1],
      OROT_DETOX_RELEASE_DATA_SIMULATOR_UDID: shards[2][1],
      OROT_DETOX_RELEASE_SHARDING: 'true',
      OROT_DETOX_TEST_LOG_LEVEL: 'info',
      CALLS_PATH: callsPath,
      PIDS_PATH: pidsPath,
      HEARTBEAT_PATH: heartbeatPath,
      ORPHAN_PID_PATH: orphanPidPath,
      FAIL_SHARD: failingShard,
    },
  };
}

function killGroup(pid) {
  if (!pid) return;
  try {
    process.kill(-Number(pid), 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function stopFixtureProcesses(fixture, runnerPid) {
  killGroup(runnerPid);
  if (!existsSync(fixture.pidsPath)) return;
  for (const pid of readFileSync(fixture.pidsPath, 'utf8').trim().split(/\s+/)) killGroup(pid);
  if (existsSync(fixture.orphanPidPath)) killGroup(readFileSync(fixture.orphanPidPath, 'utf8'));
}

function runProcess(command, args, env, fixture, timeoutMs = 6000) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      stopFixtureProcesses(fixture, child.pid);
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, pid: child.pid });
    });
  });
}

test('runs all Release wrappers concurrently with their assigned Simulators and case summaries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-shards-'));
  const fixture = makeFixture(directory);
  try {
    const result = await runProcess(process.execPath, [shardRunner], fixture.env, fixture);
    assert.equal(result.timedOut, false);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.deepEqual(
      readFileSync(fixture.callsPath, 'utf8').trim().split('\n').sort(),
      shards.map(([name, udid]) => `${name}\t${udid}`).sort(),
    );
    assert.match(
      result.stdout,
      /DETOX_RELEASE_SHARD_SUMMARY_START shard=release-e2e-data\.test\.js/,
    );
    assert.match(
      result.stdout,
      /DETOX_RELEASE_SHARD_SUMMARY_START shard=release-e2e-safe-area\.test\.js/,
    );
    assert.match(result.stdout, /Tests: 4 passed, 4 total/);
    assert.match(result.stdout, /Tests: 6 passed, 6 total/);
  } finally {
    stopFixtureProcesses(fixture);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stops an orphan Detox descendant after a shard exits unsuccessfully', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-shard-failure-'));
  const failingShard = 'release-e2e-data.test.js';
  const fixture = makeFixture(directory, failingShard);
  let runnerPid;
  try {
    const result = await runProcess(process.execPath, [shardRunner], fixture.env, fixture);
    runnerPid = result.pid;
    assert.equal(result.timedOut, false);
    assert.notEqual(result.code, 0);
    assert.ok(existsSync(fixture.orphanPidPath));
    assert.ok(existsSync(fixture.heartbeatPath));
    const stoppedAt = readFileSync(fixture.heartbeatPath, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(readFileSync(fixture.heartbeatPath, 'utf8'), stoppedAt);
  } finally {
    stopFixtureProcesses(fixture, runnerPid);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('routes the Release shell runner to explicit shards and rejects incomplete Simulator sets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-release-shard-route-'));
  const fixture = makeFixture(directory);
  const timer = join(directory, 'time');
  writeFileSync(timer, '#!/bin/sh\n[ "$1" = "-l" ] && shift\nexec "$@"\n', { mode: 0o755 });
  try {
    const routed = await runProcess(
      'bash',
      [profileRunner, 'release'],
      { ...fixture.env, OROT_DETOX_TEST_TIME_COMMAND: timer },
      fixture,
    );
    assert.equal(routed.code, 0, routed.stderr + routed.stdout);
    assert.equal(readFileSync(fixture.callsPath, 'utf8').trim().split('\n').length, 3);

    rmSync(fixture.callsPath, { force: true });
    const incomplete = await runProcess(
      'bash',
      [profileRunner, 'release'],
      { ...fixture.env, OROT_DETOX_RELEASE_SAFE_AREA_SIMULATOR_UDID: '' },
      fixture,
    );
    assert.notEqual(incomplete.code, 0);
    assert.equal(existsSync(fixture.callsPath), false);
  } finally {
    stopFixtureProcesses(fixture);
    rmSync(directory, { recursive: true, force: true });
  }
});
