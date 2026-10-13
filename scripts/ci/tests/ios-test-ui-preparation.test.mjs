import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';

// All executables and result nodes below are synthetic CLI fixtures, not native or hosted acceptance evidence.
function fixture({
  github = true,
  screenshotFailure = false,
  state = 'Booted',
  selectedDeveloper = 'provided',
  hostFailure = false,
  guiFailure = false,
  profile = 'speech',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orot-ui-preparation-'));
  const spec = iosTestConfig(profile);
  const owner = { ...spec, name: 'owned-ui-fixture', udid: '11111111-2222-4333-8444-555555555555' };
  const developer = join(root, 'SelectedXcode.app/Contents/Developer');
  mkdirSync(join(developer, '../Applications/DeviceHub.app'), { recursive: true });
  const calls = join(root, 'calls.jsonl');
  const report = {
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
const fs=require('node:fs');const args=process.argv.slice(2);const name=require('node:path').basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({name,args})+'\\n');
if(name==='xcodebuild'){if(${hostFailure})process.exit(65);fs.mkdirSync(args[args.indexOf('-resultBundlePath')+1]);process.exit(0);}
if(name==='open'){if(args.length!==2||args[0]!=='-a'||args[1]!==${JSON.stringify(join(developer, '../Applications/DeviceHub.app'))})throw new Error('Unsupported GUI launch argument');process.exit(${guiFailure ? 1 : 0});}
if(args[0]==='xcresulttool')console.log(${JSON.stringify(JSON.stringify(report))});
else if(args[1]==='list'&&args[2]==='runtimes')console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},buildversion:${JSON.stringify(spec.runtimeBuild)},isAvailable:true}]}));
else if(args[1]==='list'&&args[2]==='devices')console.log(JSON.stringify({devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:${JSON.stringify(state)}}]}}));
else if(args[1]==='io'){if(${screenshotFailure})process.exit(1);fs.writeFileSync(args.at(-1),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));}
else console.log('synthetic fixture diagnostic');
`;
  for (const name of ['xcrun', 'xcodebuild', 'open', 'vm_stat', 'sysctl', 'ps'])
    writeFileSync(join(root, name), program, { mode: 0o755 });
  const ownerFile = join(root, 'owner.json');
  const runFile = join(root, 'synthetic-products.xctestrun');
  writeFileSync(ownerFile, JSON.stringify(owner));
  writeFileSync(runFile, 'synthetic verified-product input');
  const output = join(root, 'evidence');
  const outcome = spawnSync(
    process.execPath,
    [resolve('scripts/ci/prepare-ios-test-ui.mjs'), profile, runFile, ownerFile, output],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DEVELOPER_DIR:
          selectedDeveloper === 'provided'
            ? developer
            : selectedDeveloper === 'missing'
              ? undefined
              : 'relative/Developer',
        GITHUB_ACTIONS: String(github),
        PATH: root + ':' + process.env.PATH,
      },
    },
  );
  return {
    root,
    owner,
    output,
    outcome,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [],
  };
}

test('prepares the genuine host case once on the owned destination without another boot, retry or unsupported GUI command', () => {
  for (const profile of ['speech', 'backup', 'fixtures']) {
    const value = fixture({ profile });
    try {
      assert.equal(value.outcome.status, 0, value.outcome.stderr);
      const runs = value.calls.filter((call) => call.name === 'xcodebuild');
      assert.equal(runs.length, 1);
      assert.deepEqual(
        runs[0].args.filter((arg) => arg.startsWith('-only-testing:')),
        ['-only-testing:' + hostConnectionTest],
      );
      assert.ok(runs[0].args.includes('platform=iOS Simulator,id=' + value.owner.udid));
      assert.ok(
        !value.calls.some((call) =>
          ['boot', 'shutdown', 'delete'].some((action) => call.args.includes(action)),
        ),
      );
      assert.deepEqual(
        value.calls.filter((call) => call.name === 'open').map((call) => call.args),
        [['-a', join(value.root, 'SelectedXcode.app/Contents/Applications/DeviceHub.app')]],
      );
      const report = JSON.parse(readFileSync(join(value.output, 'ui-bootstrap.json')));
      assert.equal(report.hostConnectionVerified, true);
      assert.equal(report.guiApplication, 'DeviceHub');
      assert.equal(report.targetedGuiLaunch, 'unsupported');
      assert.equal(report.guiLaunch, 'opened');
      assert.equal(report.screenshot, 'captured');
      assert.ok(!('accessibilityReady' in report));
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('an unavailable optional GUI launch stays diagnostic and cannot invent Accessibility readiness', () => {
  const value = fixture({ guiFailure: true });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    const report = JSON.parse(readFileSync(join(value.output, 'ui-bootstrap.json')));
    assert.equal(report.guiLaunch, 'unavailable');
    assert.ok(!('accessibilityReady' in report));
    assert.equal(value.calls.filter((call) => call.name === 'open').length, 1);
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
    assert.equal(report.hostConnectionVerified, true);
    assert.ok(!('accessibilityReady' in report));
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('a failed first native host result remains failed and prevents later preparation evidence', () => {
  const value = fixture({ hostFailure: true });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
    assert.ok(!existsSync(join(value.output, 'ui-bootstrap.json')));
    assert.ok(!value.calls.some((call) => call.args[1] === 'io'));
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('refuses local or inactive destinations before executing native preparation', () => {
  for (const options of [{ github: false }, { state: 'Shutdown' }]) {
    const value = fixture(options);
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.ok(!value.calls.some((call) => call.name === 'xcodebuild'));
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('refuses absent or relative selected Xcode directories before executing native preparation', () => {
  for (const selectedDeveloper of ['missing', 'relative']) {
    const value = fixture({ selectedDeveloper });
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.match(value.outcome.stderr, /explicit selected Xcode directory/);
      assert.ok(!value.calls.some((call) => call.name === 'xcodebuild'));
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});
