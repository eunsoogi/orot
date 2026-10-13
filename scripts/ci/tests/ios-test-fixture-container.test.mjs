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
  { preserveKeychain = false, state = 'Booted', ownerProfile = profile, action = 'reset' } = {},
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
  const program = `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);const name=require('node:path').basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({name,args})+'\\n');
if(name==='plutil')console.log(JSON.stringify(fs.existsSync(${JSON.stringify(removed)})?{}:{'com.orot.mobile':{}}));
else if(args[1]==='list'&&args[2]==='runtimes')console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},isAvailable:true}]}));
else if(args[1]==='list'&&args[2]==='devices')console.log(JSON.stringify({devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:${JSON.stringify(state)}}]}}));
else {if(args[1]==='uninstall')fs.writeFileSync(${JSON.stringify(removed)},'removed');if(args[1]==='install'&&fs.existsSync(${JSON.stringify(removed)}))fs.unlinkSync(${JSON.stringify(removed)});console.log('synthetic fixture response');}
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
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
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
      assert.equal(value.calls.filter((call) => call.name === 'plutil').length, 2);
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
