import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';

// Drive the actual CLI with public-command fixtures; policy tests must never boot a device or sample their host.
function run(bootStatus, hosted = false, cacheStatus = 0) {
  const root = mkdtempSync(join(tmpdir(), 'orot-boot-observation-'));
  const ownerPath = join(root, 'owner.json');
  const config = iosTestConfig('speech');
  const name = 'OrotTests-cohort-speech-local-1';
  const device = { udid: 'owned-device', name, deviceTypeIdentifier: config.device };
  const runtimes = [
    { identifier: config.runtime, buildversion: config.runtimeBuild, isAvailable: true },
  ];
  const snapshot = { runtimes, devices: { [config.runtime]: [device] } };
  const calls = join(root, 'calls.jsonl');
  writeFileSync(
    join(root, 'xcrun'),
    `#!${process.execPath}
const fs=require('node:fs'); const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
const command=args[1];
if(command==='list')console.log(${JSON.stringify(JSON.stringify(snapshot))});
else if(command==='create')console.log('owned-device');
else if(command==='runtime') { console.log('Runtime shared cache ready'); process.exit(${cacheStatus}); }
else if(command==='bootstatus') { console.log('Waiting for Data Migration'); process.exit(${bootStatus}); }
else if(command!=='boot')process.exit(99);
`,
    { mode: 0o755 },
  );
  for (const program of ['vm_stat', 'sysctl', 'ps'])
    writeFileSync(
      join(root, program),
      `#!${process.execPath}\nconsole.log('synthetic ${program}');\n`,
      {
        mode: 0o755,
      },
    );
  const outcome = spawnSync(
    process.execPath,
    ['scripts/ci/ios-test-simulator.mjs', 'prepare-cohort', 'speech', ownerPath],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: root + ':' + process.env.PATH,
        GITHUB_RUN_ID: 'local',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_ENV: '',
        GITHUB_ACTIONS: String(hosted),
        RUNNER_ENVIRONMENT: hosted ? 'github-hosted' : 'self-hosted',
      },
    },
  );
  return {
    root,
    ownerPath,
    outcome,
    calls: readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
  };
}

for (const status of [0, 65])
  test(`boot progress and resources survive status ${status} without a retry or another destination`, () => {
    const value = run(status);
    try {
      assert.equal(value.outcome.status === 0, status === 0, value.outcome.stderr);
      assert.match(value.outcome.stdout, /Waiting for Data Migration/);
      const resources = readFileSync(value.ownerPath + '.boot.resources.jsonl', 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.deepEqual(
        resources.map((sample) => sample.stage),
        ['before', 'after'],
      );
      assert.ok(resources.every((sample) => sample.observations.processes === 'synthetic ps\n'));
      assert.equal(value.calls.filter((args) => args[1] === 'boot').length, 1);
      assert.deepEqual(
        value.calls.filter((args) => args[1] === 'bootstatus'),
        [['simctl', 'bootstatus', 'owned-device', '-b']],
      );
      assert.equal(JSON.parse(readFileSync(value.ownerPath, 'utf8')).udid, 'owned-device');
      // The owner remains available to the workflow's unconditional cleanup even if boot fails.
      if (status !== 0) assert.match(value.outcome.stderr, /bootstatus failed: 65/);
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

test('hosted preparation completes only the selected runtime cache before creating or booting a device', () => {
  for (const status of [0, 65]) {
    const value = run(0, true, status);
    try {
      assert.equal(value.outcome.status === 0, status === 0, value.outcome.stderr);
      const cache = value.calls.findIndex((args) => args[1] === 'runtime');
      assert.deepEqual(value.calls[cache], [
        'simctl',
        'runtime',
        'dyld_shared_cache',
        'update',
        iosTestConfig('speech').runtime,
      ]);
      if (status === 0) {
        assert.ok(cache < value.calls.findIndex((args) => args[1] === 'create'));
        assert.ok(cache < value.calls.findIndex((args) => args[1] === 'boot'));
        assert.match(value.outcome.stdout, /Runtime shared cache ready/);
      } else {
        assert.ok(value.calls.every((args) => !['create', 'boot', 'bootstatus'].includes(args[1])));
      }
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('local and self-hosted preparation does not update shared runtime caches', () => {
  const value = run(0);
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.ok(value.calls.every((args) => args[1] !== 'runtime'));
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
