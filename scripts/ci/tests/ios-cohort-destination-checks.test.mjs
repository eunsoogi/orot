import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestCohort } from '../ios-test-cohorts.mjs';

// Exercise the real coordinator and first native driver; only external Apple commands are replaced.
function run(state) {
  const root = mkdtempSync(join(tmpdir(), 'orot-cohort-destination-'));
  const definition = iosTestCohort('debug');
  const owner = {
    cohort: 'debug',
    profiles: definition.profiles,
    runtime: definition.config.runtime,
    device: definition.config.device,
    name: 'OrotTests-cohort-debug-fixture',
    udid: 'owned-destination',
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
  const program = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({name,args})+'\\n');
if(name==='xcodebuild')process.exit(65);
if(name==='xcrun'&&args[1]==='list')console.log(${JSON.stringify(JSON.stringify(snapshot))});
else console.log('synthetic bounded diagnostic');
`;
  for (const name of ['xcrun', 'xcodebuild', 'ps', 'vm_stat', 'sysctl'])
    writeFileSync(join(root, name), program, { mode: 0o755 });
  const ownerFile = join(root, 'owner.json'),
    runFile = join(root, 'products.xctestrun');
  const results = join(root, 'results');
  writeFileSync(ownerFile, JSON.stringify(owner));
  writeFileSync(runFile, 'verified by the separate product boundary');
  const outcome = spawnSync(
    process.execPath,
    [resolve('scripts/ci/run-ios-test-cohort.mjs'), 'debug', runFile, ownerFile, results],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: root + ':' + process.env.PATH },
    },
  );
  return {
    outcome,
    calls: () => readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
    report: () => JSON.parse(readFileSync(join(results, 'results.json'), 'utf8')),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('the executing driver checks its destination once before Xcode without duplicate coordinator inventories', () => {
  const value = run('Booted');
  try {
    assert.notEqual(value.outcome.status, 0);
    const calls = value.calls();
    assert.equal(calls.filter((call) => call.args[1] === 'list').length, 1);
    assert.equal(calls.filter((call) => call.name === 'xcodebuild').length, 1);
    assert.ok(
      calls.findIndex((call) => call.args[1] === 'list') <
        calls.findIndex((call) => call.name === 'xcodebuild'),
    );
    assert.deepEqual(
      value.report().tasks.map((task) => task.status),
      ['failed', 'not-run', 'not-run', 'not-run'],
    );
  } finally {
    value.dispose();
  }
});

test('an unbooted live destination fails before Xcode and is retained as the first task failure', () => {
  const value = run('Shutdown');
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.ok(!value.calls().some((call) => call.name === 'xcodebuild'));
    assert.equal(value.report().passed, false);
    assert.deepEqual(
      value.report().tasks.map((task) => task.status),
      ['failed', 'not-run', 'not-run', 'not-run'],
    );
  } finally {
    value.dispose();
  }
});
