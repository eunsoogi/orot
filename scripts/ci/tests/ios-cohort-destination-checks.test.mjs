import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestCohort } from '../ios-test-cohorts.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';

// Exercise the real coordinator and first native driver; only external Apple commands are replaced.
function run(state, cohort = 'debug') {
  const root = mkdtempSync(join(tmpdir(), 'orot-cohort-destination-'));
  const definition = iosTestCohort(cohort);
  const owner = {
    cohort,
    profiles: definition.profiles,
    runtime: definition.config.runtime,
    device: definition.config.device,
    name: `OrotTests-cohort-${cohort}-fixture`,
    udid: '11111111-2222-4333-8444-555555555555',
  };
  const calls = join(root, 'calls.jsonl');
  const snapshot = {
    runtimes: [{ identifier: owner.runtime, isAvailable: true }],
    devices: {
      [owner.runtime]: [
        { udid: owner.udid, name: owner.name, deviceTypeIdentifier: owner.device, state },
      ],
    },
  };
  const hostReport = {
    testNodes: [
      {
        nodeType: 'Unit test bundle',
        name: 'OrotIntegrationTests',
        children: [
          {
            nodeType: 'Test Case',
            nodeIdentifier: hostConnectionTest.split('/').slice(1).join('/') + '()',
            result: 'Passed',
          },
        ],
      },
    ],
  };
  const program = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({name,args})+'\\n');
if(name==='xcodebuild'){
 if(args.includes('-only-testing:${hostConnectionTest}')){fs.mkdirSync(args[args.indexOf('-resultBundlePath')+1]);process.exit(0);}
 process.exit(65);
}
if(name==='open')process.exit(0);
if(name==='xcrun'&&args[0]==='xcresulttool'&&args.some(argument=>argument.includes('ui-preparation')))console.log(${JSON.stringify(JSON.stringify(hostReport))});
else if(name==='xcrun'&&args[1]==='list')console.log(${JSON.stringify(JSON.stringify(snapshot))});
else console.log('synthetic bounded diagnostic');
`;
  for (const name of ['xcrun', 'xcodebuild', 'open', 'ps', 'vm_stat', 'sysctl'])
    writeFileSync(join(root, name), program, { mode: 0o755 });
  const ownerFile = join(root, 'owner.json'),
    runFile = join(root, 'products.xctestrun');
  const results = join(root, 'results');
  writeFileSync(ownerFile, JSON.stringify(owner));
  writeFileSync(runFile, 'verified by the separate product boundary');
  const outcome = spawnSync(
    process.execPath,
    [resolve('scripts/ci/run-ios-test-cohort.mjs'), cohort, runFile, ownerFile, results],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        PROFILE: definition.profiles[0],
        DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'debug-test',
        PATH: root + ':' + process.env.PATH,
      },
    },
  );
  return {
    root,
    outcome,
    calls: () => readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
    report: () => JSON.parse(readFileSync(join(results, 'results.json'), 'utf8')),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('each Xcode execution verifies its owned destination once at the operation boundary', () => {
  const value = run('Booted');
  try {
    assert.notEqual(value.outcome.status, 0);
    const calls = value.calls();
    const inventories = calls.filter((call) => call.name === 'xcrun' && call.args[1] === 'list');
    const builds = calls.filter((call) => call.name === 'xcodebuild');
    assert.equal(inventories.length, 2);
    assert.equal(
      builds.length,
      2,
      `${value.outcome.stdout}\n${value.outcome.stderr}\n${JSON.stringify(calls)}`,
    );
    assert.deepEqual(
      builds[0].args.filter((argument) => argument.startsWith('-only-testing:')),
      ['-only-testing:' + hostConnectionTest],
    );
    assert.ok(calls.indexOf(inventories[0]) < calls.indexOf(builds[0]));
    assert.ok(calls.indexOf(builds[0]) < calls.indexOf(inventories[1]));
    assert.ok(calls.indexOf(inventories[1]) < calls.indexOf(builds[1]));
    assert.deepEqual(
      value.report().tasks.map((task) => task.status),
      ['failed', 'not-run', 'not-run', 'not-run'],
    );
    assert.ok(Number.isFinite(value.report().elapsedMs));
    assert.ok(Number.isFinite(value.report().uiPreparationElapsedMs));
    assert.ok(Number.isFinite(value.report().uiBootstrapElapsedMs));
    assert.match(value.outcome.stdout, /ui_preparation_ms=\d+(?:\.\d+)?/);
    assert.match(value.outcome.stdout, /ui_bootstrap_ms=\d+(?:\.\d+)?/);
  } finally {
    value.dispose();
  }
});

test('cohorts without UI preparation keep the separate timing fields not applicable', () => {
  const value = run('Booted', 'core-integration');
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.ok(
      existsSync(join(value.root, 'results/results.json')),
      `${value.outcome.stdout}\n${value.outcome.stderr}`,
    );
    assert.equal(value.report().uiPreparationElapsedMs, null);
    assert.equal(value.report().uiBootstrapElapsedMs, null);
    assert.match(
      value.outcome.stdout,
      /ui_preparation_ms=not_required ui_bootstrap_ms=not_required/,
    );
  } finally {
    value.dispose();
  }
});

test('an unbooted live destination fails before either preparation or task Xcode execution', () => {
  const value = run('Shutdown');
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.match(
      readFileSync(join(value.root, 'ui-preparation.log'), 'utf8'),
      /booted owned simulator/,
    );
    assert.ok(!value.calls().some((call) => call.name === 'xcodebuild'));
  } finally {
    value.dispose();
  }
});
