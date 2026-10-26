import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';

// Drive the actual CLI with public-command fixtures; policy tests must never boot a device or sample their host.
function run(
  bootStatus,
  hosted = false,
  cacheStatus = 0,
  blockedDiagnostic = false,
  bootStatusCode = 0,
) {
  const root = mkdtempSync(join(tmpdir(), 'orot-boot-observation-'));
  const ownerPath = join(root, 'owner.json');
  const config = iosTestConfig('speech');
  const name = 'OrotTests-cohort-speech-local-1';
  const device = { udid: 'owned-device', name, deviceTypeIdentifier: config.device };
  const runtimes = [
    { identifier: config.runtime, buildversion: config.runtimeBuild, isAvailable: true },
  ];
  const snapshot = { runtimes, devices: { [config.runtime]: [device] }, pairs: {} };
  if (blockedDiagnostic) mkdirSync(ownerPath + '.preparation.jsonl');
  const environment = join(root, 'github-env');
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
else if(command==='boot')process.exit(${bootStatusCode});
else if(command==='bootstatus') {
 console.log('Waiting for Data Migration');
 if(${blockedDiagnostic}){const file=${JSON.stringify(ownerPath + '.boot.resources.jsonl')};fs.unlinkSync(file);fs.mkdirSync(file);}
 ${typeof bootStatus === 'string' ? `process.kill(process.pid,${JSON.stringify(bootStatus)});` : `process.exit(${bootStatus});`}
}
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
        GITHUB_ENV: environment,
        GITHUB_ACTIONS: String(hosted),
        RUNNER_ENVIRONMENT: hosted ? 'github-hosted' : 'self-hosted',
      },
    },
  );
  return {
    root,
    ownerPath,
    environment,
    outcome,
    calls: readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
  };
}

for (const status of [0, 65])
  test(`boot readiness status ${status} keeps its required final resource observations`, () => {
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
      assert.equal(resources[0].observations.processes, 'synthetic ps\n');
      // Skip only after readiness succeeds; failures retain process evidence beside memory and swap.
      assert.deepEqual(
        resources[1].observations,
        status === 0
          ? {
              memory: 'synthetic vm_stat\n',
              swap: 'synthetic sysctl\n',
              processes: {
                unavailable: 'process snapshot skipped after readiness or test success',
              },
            }
          : {
              memory: 'synthetic vm_stat\n',
              swap: 'synthetic sysctl\n',
              processes: 'synthetic ps\n',
            },
      );
      assert.ok(Number.isFinite(resources[1].commandElapsedMs.memory));
      assert.ok(Number.isFinite(resources[1].commandElapsedMs.swap));
      assert.equal(resources[1].commandElapsedMs.processes === null, status === 0);
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

test('a failed simulator boot retains the final process sample and does not publish readiness', () => {
  const value = run(0, false, 0, false, 65);
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.equal(existsSync(value.environment), false);
    assert.equal(value.calls.filter((args) => args[1] === 'bootstatus').length, 0);
    const resources = readFileSync(value.ownerPath + '.boot.resources.jsonl', 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(resources[0].observations.processes, 'synthetic ps\n');
    assert.equal(resources[1].observations.processes, 'synthetic ps\n');
    assert.ok(Number.isFinite(resources[1].commandElapsedMs.processes));
    const diagnostics = readFileSync(value.ownerPath + '.preparation.jsonl', 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(diagnostics.at(-1).event, 'boot-failed');
    assert.equal(diagnostics.at(-1).stage, 'boot');
    assert.equal(diagnostics.at(-1).status, 65);
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

test('a real bootstatus SIGABRT preserves the original signal and prevents readiness publication', () => {
  for (const blockedDiagnostic of [false, true]) {
    const value = run('SIGABRT', false, 0, blockedDiagnostic);
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.match(value.outcome.stderr, /bootstatus failed: SIGABRT/);
      assert.equal(existsSync(value.environment), false);
      const records = value.outcome.stderr
        .split('\n')
        .filter((line) => line.startsWith('IOS_PREPARATION_DIAGNOSTIC '))
        .map((line) => JSON.parse(line.slice('IOS_PREPARATION_DIAGNOSTIC '.length)));
      const failure = records.find((record) => record.event === 'boot-failed');
      assert.equal(failure?.signal, 'SIGABRT');
      assert.equal(failure?.status, null);
      assert.equal(failure?.stage, 'bootstatus');
      if (!blockedDiagnostic) {
        const saved = readFileSync(value.ownerPath + '.preparation.jsonl', 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse);
        assert.equal(saved[0].event, 'pre-boot-inventory');
        assert.deepEqual(saved[0].pairs, { status: 'observed-empty', entryCount: 0 });
        assert.equal(saved.at(-1).signal, 'SIGABRT');
        const resources = readFileSync(value.ownerPath + '.boot.resources.jsonl', 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse);
        assert.equal(resources.at(-1).observations.processes, 'synthetic ps\n');
      } else {
        assert.match(value.outcome.stderr, /diagnostic-write-failed/);
        assert.match(value.outcome.stderr, /resource-write-failed/);
      }
      assert.equal(value.calls.filter((args) => args[1] === 'boot').length, 1);
      assert.equal(value.calls.filter((args) => args[1] === 'bootstatus').length, 1);
      assert.equal(value.calls.filter((args) => args[1] === 'list' && args[2] === '-j').length, 1);
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
