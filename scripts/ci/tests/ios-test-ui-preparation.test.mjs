import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';

function fixture({ github = true, screenshotFailure = false, state = 'Booted' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orot-ui-preparation-'));
  const spec = iosTestConfig('speech');
  const owner = { ...spec, name: 'owned-ui-fixture', udid: '11111111-2222-4333-8444-555555555555' };
  const developer = join(root, 'SelectedXcode.app/Contents/Developer');
  const simulator = join(developer, 'Applications/Simulator.app');
  mkdirSync(simulator, { recursive: true });
  const calls = join(root, 'calls.jsonl');
  const program = `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);const name=require('node:path').basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({name,args})+'\\n');
if(name==='open')process.exit(0);
if(args[0]==='--find')console.log(${JSON.stringify(join(developer, 'usr/bin/simctl'))});
else if(args[1]==='list'&&args[2]==='runtimes')console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},buildversion:${JSON.stringify(spec.runtimeBuild)},isAvailable:true}]}));
else if(args[1]==='list'&&args[2]==='devices')console.log(JSON.stringify({devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:${JSON.stringify(state)}}]}}));
else if(args[1]==='io'){if(${screenshotFailure})process.exit(1);fs.writeFileSync(args.at(-1),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));}
`;
  for (const name of ['xcrun', 'open']) writeFileSync(join(root, name), program, { mode: 0o755 });
  const ownerFile = join(root, 'owner.json');
  writeFileSync(ownerFile, JSON.stringify(owner));
  const output = join(root, 'evidence');
  const outcome = spawnSync(
    process.execPath,
    [resolve('scripts/ci/prepare-ios-test-ui.mjs'), 'speech', ownerFile, output],
    {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: String(github), PATH: root + ':' + process.env.PATH },
    },
  );
  return {
    root,
    simulator,
    owner,
    output,
    outcome,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [],
  };
}

test('opens only the owned destination in the verified Xcode application without another boot', () => {
  const value = fixture();
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.deepEqual(
      value.calls.filter((call) => call.name === 'open').map((call) => call.args),
      [[value.simulator, '--args', '-CurrentDeviceUDID', value.owner.udid]],
    );
    assert.ok(
      !value.calls.some(
        (call) =>
          call.args.includes('boot') ||
          call.args.includes('shutdown') ||
          call.args.includes('delete'),
      ),
    );
    assert.equal(
      JSON.parse(readFileSync(join(value.output, 'ui-bootstrap.json'))).screenshot,
      'captured',
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('an unavailable optional screenshot cannot manufacture readiness or prevent actual XCUI execution', () => {
  const value = fixture({ screenshotFailure: true });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    const report = JSON.parse(readFileSync(join(value.output, 'ui-bootstrap.json')));
    assert.equal(report.screenshot, 'unavailable');
    assert.equal(report.simulatorAppOpenRequested, true);
    assert.ok(!('accessibilityReady' in report));
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('refuses local or inactive destinations before requesting the Simulator application', () => {
  for (const options of [{ github: false }, { state: 'Shutdown' }]) {
    const value = fixture(options);
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.ok(!value.calls.some((call) => call.name === 'open'));
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});
