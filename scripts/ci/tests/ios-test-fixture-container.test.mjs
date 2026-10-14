import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';

function fixture(
  profile,
  {
    preserveKeychain = false,
    state = 'Booted',
    ownerProfile = profile,
    action = 'reset',
    installed = true,
    containerError = false,
    loseOwnershipAfterUninstall = false,
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'orot-fixture-reset-'));
  const spec = iosTestConfig(profile);
  const owner = {
    ...spec,
    profile: ownerProfile,
    name: 'owned-synthetic-fixture',
    udid: '11111111-2222-4333-8444-555555555555',
  };
  const calls = join(root, 'calls.jsonl');
  const removed = join(root, 'removed.flag');
  const lostOwner = join(root, 'lost-owner.flag');
  const program = `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);const name=require('node:path').basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({name,args})+'\\n');
if(name==='plutil')console.log(JSON.stringify(fs.existsSync(${JSON.stringify(removed)})?{}:{'com.orot.mobile':{}}));
else if(args[1]==='list'&&args[2]==='-j')console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},isAvailable:true}],devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:fs.existsSync(${JSON.stringify(lostOwner)})?'foreign-owner':${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:${JSON.stringify(state)}}]}}));
else if(args[1]==='get_app_container'){if(${containerError}){console.error('Synthetic service unavailable');process.exit(1);}if(!${installed}||fs.existsSync(${JSON.stringify(removed)})){console.error('An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2): No such file or directory');process.exit(2);}console.log('/synthetic/owned/Orot.app');}
else {if(args[1]==='uninstall'){fs.writeFileSync(${JSON.stringify(removed)},'removed');if(${loseOwnershipAfterUninstall})fs.writeFileSync(${JSON.stringify(lostOwner)},'lost');}if(args[1]==='install'&&fs.existsSync(${JSON.stringify(removed)}))fs.unlinkSync(${JSON.stringify(removed)});console.log('synthetic fixture response');}
`;
  for (const name of ['xcrun', 'plutil']) writeFileSync(join(root, name), program, { mode: 0o755 });
  const app = join(root, 'Orot.app');
  const entry =
    action === 'cleanup' ? 'removeIosTestFixtureContainer' : 'resetIosTestFixtureContainer';
  const code = `import {${entry} as operation} from ${JSON.stringify(pathToFileURL(resolve('scripts/ci/ios-test-fixture-container.mjs')).href)}; operation(${JSON.stringify(profile)},${JSON.stringify(owner)},${JSON.stringify(app)},${JSON.stringify({ preserveKeychain })});`;
  const outcome = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
    env: { ...process.env, PATH: root + ':' + process.env.PATH },
  });
  return {
    root,
    owner,
    app,
    outcome,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [],
  };
}

test('fresh isolated cases reset only their owned app and Keychain without booting another device', () => {
  for (const profile of [
    'fixtures',
    'health-import',
    'microphone',
    'local-model',
    'provider-selection',
  ]) {
    const value = fixture(profile);
    try {
      assert.equal(value.outcome.status, 0, value.outcome.stderr);
      const mutations = value.calls.filter((call) =>
        ['uninstall', 'keychain', 'install'].includes(call.args[1]),
      );
      assert.deepEqual(
        mutations.map((call) => call.args),
        [
          ['simctl', 'uninstall', value.owner.udid, 'com.orot.mobile'],
          ['simctl', 'keychain', value.owner.udid, 'reset'],
          ['simctl', 'install', value.owner.udid, value.app],
        ],
      );
      assert.ok(!value.calls.some((call) => ['boot', 'shutdown', 'delete'].includes(call.args[1])));
      // Reset needs only this bundle's installation state; full application enumeration stalled before the hosted backup case.
      assert.ok(!value.calls.some((call) => call.args[1] === 'listapps'));
      // Each read or mutation has its own fresh ownership observation, with no extra inventory process.
      for (let index = 0; index < value.calls.length; index += 2) {
        assert.deepEqual(value.calls[index].args, ['simctl', 'list', '-j']);
        assert.notEqual(value.calls[index + 1].args[1], 'list');
      }
      const timings = value.outcome.stderr
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map(JSON.parse);
      assert.equal(timings.filter((item) => item.phase === 'finished').length, value.calls.length);
      assert.ok(
        timings
          .filter((item) => item.phase === 'finished')
          .every((item) => item.status === 0 && item.elapsedMs >= 0),
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('ownership lost after one mutation prevents the next mutation instead of reusing a stale inventory', () => {
  const value = fixture('fixtures', { loseOwnershipAfterUninstall: true });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.match(value.outcome.stderr, /ownership mismatch/);
    assert.deepEqual(
      value.calls
        .filter((call) => ['uninstall', 'keychain', 'install'].includes(call.args[1]))
        .map((call) => call.args[1]),
      ['uninstall'],
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('completed and failed independent cases remove only their owned app container and verify absence', () => {
  for (const profile of ['fixtures', 'health-import', 'microphone', 'provider-selection']) {
    const value = fixture(profile, { action: 'cleanup' });
    try {
      assert.equal(value.outcome.status, 0, value.outcome.stderr);
      const mutations = value.calls.filter((call) =>
        ['uninstall', 'keychain', 'install', 'boot', 'delete'].includes(call.args[1]),
      );
      assert.deepEqual(
        mutations.map((call) => call.args),
        [['simctl', 'uninstall', value.owner.udid, 'com.orot.mobile']],
      );
      assert.deepEqual(
        value.calls.filter((call) => call.args[1] === 'get_app_container').map((call) => call.args),
        [
          ['simctl', 'get_app_container', value.owner.udid, 'com.orot.mobile', 'app'],
          ['simctl', 'get_app_container', value.owner.udid, 'com.orot.mobile', 'app'],
        ],
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
  for (const [profile, options] of [
    ['core', {}],
    ['backup', {}],
    ['local-model', {}],
    ['fixtures', { ownerProfile: 'core' }],
    ['fixtures', { state: 'Shutdown' }],
  ]) {
    const value = fixture(profile, { ...options, action: 'cleanup' });
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.ok(
        !value.calls.some((call) => ['uninstall', 'keychain', 'install'].includes(call.args[1])),
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('absent owned bundles are distinguished from container service errors before mutation', () => {
  for (const action of ['reset', 'cleanup']) {
    const absent = fixture('fixtures', { action, installed: false });
    const unavailable = fixture('fixtures', { action, containerError: true });
    try {
      assert.equal(absent.outcome.status, 0, absent.outcome.stderr);
      assert.ok(!absent.calls.some((call) => call.args[1] === 'uninstall'));
      assert.notEqual(unavailable.outcome.status, 0);
      assert.match(unavailable.outcome.stderr, /Synthetic service unavailable/);
      assert.ok(
        !unavailable.calls.some((call) =>
          ['uninstall', 'install', 'keychain'].includes(call.args[1]),
        ),
      );
    } finally {
      rmSync(absent.root, { recursive: true, force: true });
      rmSync(unavailable.root, { recursive: true, force: true });
    }
  }
});

test('snapshot reinstall keeps its separate Keychain boundary', () => {
  const value = fixture('backup', { preserveKeychain: true });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.ok(!value.calls.some((call) => call.args[1] === 'keychain'));
    assert.equal(value.calls.filter((call) => call.args[1] === 'uninstall').length, 1);
    assert.equal(value.calls.filter((call) => call.args[1] === 'install').length, 1);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('refuses shared Core, mismatched ownership, inactive devices and unsupported Keychain preservation before mutation', () => {
  for (const [profile, options] of [
    ['core', {}],
    ['fixtures', { ownerProfile: 'core' }],
    ['fixtures', { state: 'Shutdown' }],
    ['fixtures', { preserveKeychain: true }],
    ['health-import', { preserveKeychain: true }],
    ['health-import', { ownerProfile: 'provider-data' }],
    ['microphone', { preserveKeychain: true }],
    ['microphone', { ownerProfile: 'provider-data' }],
    ['local-model', { preserveKeychain: true }],
    ['local-model', { ownerProfile: 'core' }],
    ['provider-selection', { preserveKeychain: true }],
    ['provider-selection', { ownerProfile: 'provider-data' }],
  ]) {
    const value = fixture(profile, options);
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.ok(
        !value.calls.some((call) => ['uninstall', 'keychain', 'install'].includes(call.args[1])),
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});
