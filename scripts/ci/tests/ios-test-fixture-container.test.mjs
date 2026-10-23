import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { fixture } from './fixtures/ios-test-fixture-container.mjs';

test('fresh isolated cases reset only their owned app and Keychain without booting another device', () => {
  for (const profile of [
    'core',
    'fixtures',
    'health-import',
    'microphone',
    'local-model',
    'provider-selection',
  ]) {
    const value = fixture(profile, { statePersistence: profile === 'core' });
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
      // The exact read-only app lookup needs no inventory; each following mutation keeps a fresh one.
      assert.deepEqual(
        value.calls.map((call) => call.args[1]),
        ['get_app_container', 'list', 'uninstall', 'list', 'keychain', 'list', 'install'],
      );
      for (let index = 1; index < value.calls.length; index += 2)
        assert.deepEqual(value.calls[index].args, ['simctl', 'list', '-j']);
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

test('independent cleanup directly uninstalls the exact owned bundle and proves absence in four commands', () => {
  for (const profile of [
    'fixtures',
    'health-import',
    'microphone',
    'provider-selection',
    'backup',
  ]) {
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
        value.calls.map((call) => call.args),
        [
          ['simctl', 'list', '-j'],
          ['simctl', 'uninstall', value.owner.udid, 'com.orot.mobile'],
          ['simctl', 'list', '-j'],
          ['simctl', 'get_app_container', value.owner.udid, 'com.orot.mobile', 'app'],
        ],
      );
      assert.deepEqual(JSON.parse(value.outcome.stdout), {
        uninstallCompleted: true,
        installed: false,
      });
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
  for (const [profile, options] of [
    ['core', {}],
    ['backup', { ownerProfile: 'core' }],
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
      if (options.state === 'Shutdown')
        assert.deepEqual(
          value.calls.map((call) => call.args[1]),
          ['list'],
        );
      else assert.deepEqual(value.calls, []);
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('fresh setup distinguishes absent owned bundles from container service errors before mutation', () => {
  const absent = fixture('fixtures', { installed: false });
  const unavailable = fixture('fixtures', { containerError: true });
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
    ['fixtures', { statePersistence: true }],
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
      if (options.state === 'Shutdown')
        assert.deepEqual(
          value.calls.map((call) => call.args[1]),
          ['get_app_container', 'list'],
        );
      else assert.deepEqual(value.calls, []);
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});
