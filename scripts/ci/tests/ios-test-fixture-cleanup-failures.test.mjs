import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { fixture } from './fixtures/ios-test-fixture-container.mjs';

test('an already absent app still requires successful uninstall and a fresh absence observation', () => {
  const value = fixture('fixtures', { action: 'cleanup', installed: false });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
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
});

test('cleanup rejects a remaining app, lost ownership and service errors without a success receipt', () => {
  const cases = [
    [{ retainAppAfterUninstall: true }, /remained after cleanup/, 1],
    [{ loseOwnershipAfterUninstall: true }, /ownership mismatch/, 0],
    [{ uninstallError: true }, /Synthetic uninstall service failure/, 0],
    [{ containerError: true }, /Synthetic service unavailable/, 1],
  ];
  for (const [options, message, containerQueries] of cases) {
    const value = fixture('fixtures', { action: 'cleanup', ...options });
    try {
      assert.equal(value.outcome.status, 1, value.outcome.stderr);
      assert.match(value.outcome.stderr, message);
      assert.doesNotMatch(value.outcome.stdout, /uninstallCompleted/);
      assert.equal(value.calls.filter((call) => call.args[1] === 'uninstall').length, 1);
      assert.equal(
        value.calls.filter((call) => call.args[1] === 'get_app_container').length,
        containerQueries,
      );
      assert.ok(
        !value.calls.some((call) => ['keychain', 'install', 'delete'].includes(call.args[1])),
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('cleanup waits for an actual successful child beyond thirty seconds and then verifies absence', () => {
  const value = fixture('fixtures', { action: 'cleanup', slowOperation: 'uninstall' });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.deepEqual(JSON.parse(value.outcome.stdout), {
      uninstallCompleted: true,
      installed: false,
    });
    const completed = value.outcome.stderr
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map(JSON.parse)
      .find((item) => item.phase === 'finished' && item.arguments[0] === 'uninstall');
    assert.equal(completed.status, 0);
    assert.equal(completed.signal, null);
    assert.ok(completed.elapsedMs >= 31000);
    assert.equal(value.calls.filter((call) => call.args[1] === 'uninstall').length, 1);
    assert.equal(value.calls.filter((call) => call.args[1] === 'get_app_container').length, 1);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('a signaled uninstall or absence query cannot become a successful cleanup or retry', () => {
  for (const signalOperation of ['uninstall', 'get_app_container']) {
    const value = fixture('fixtures', { action: 'cleanup', signalOperation });
    try {
      assert.equal(value.outcome.status, 1, value.outcome.stderr);
      assert.doesNotMatch(value.outcome.stdout, /uninstallCompleted/);
      const failed = value.outcome.stderr
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map(JSON.parse)
        .find((item) => item.phase === 'finished' && item.signal === 'SIGTERM');
      assert.equal(failed.arguments[0], signalOperation);
      assert.equal(failed.status, null);
      assert.equal(failed.signal, 'SIGTERM');
      // Neither an uninstall nor its postcondition is retried after the first failed command.
      assert.equal(value.calls.filter((call) => call.args[1] === 'uninstall').length, 1);
      assert.equal(
        value.calls.filter((call) => call.args[1] === 'get_app_container').length,
        signalOperation === 'uninstall' ? 0 : 1,
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});
