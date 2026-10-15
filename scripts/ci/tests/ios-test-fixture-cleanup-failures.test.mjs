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

test('uninstall and absence-query timeouts retain the real thirty-second deadline and stop cleanup', () => {
  for (const timeoutOperation of ['uninstall', 'get_app_container']) {
    const value = fixture('fixtures', { action: 'cleanup', timeoutOperation });
    try {
      assert.equal(value.outcome.status, 1, value.outcome.stderr);
      assert.match(value.outcome.stderr, /ETIMEDOUT/);
      assert.doesNotMatch(value.outcome.stdout, /uninstallCompleted/);
      const timeout = value.outcome.stderr
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map(JSON.parse)
        .find((item) => item.phase === 'finished' && item.errorCode === 'ETIMEDOUT');
      assert.equal(timeout.arguments[0], timeoutOperation);
      assert.equal(timeout.status, null);
      assert.equal(timeout.signal, 'SIGTERM');
      assert.ok(timeout.elapsedMs >= 30000 && timeout.elapsedMs < 40000);
      // Neither an uninstall nor its postcondition is retried after the first failed command.
      assert.equal(value.calls.filter((call) => call.args[1] === 'uninstall').length, 1);
      assert.equal(
        value.calls.filter((call) => call.args[1] === 'get_app_container').length,
        timeoutOperation === 'uninstall' ? 0 : 1,
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});
