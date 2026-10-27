import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './fixtures/ios-test-fixture-driver.mjs';

test('a failed first fixture preserves its result and cleanup without installing the next case', () => {
  const value = fixture();
  try {
    assert.notEqual(value.outcome.status, 0);
    const executions = value.calls.filter((call) => call.name === 'xcodebuild');
    assert.deepEqual(
      executions.map((call) => call.args.find((arg) => arg.startsWith('-only-testing:')).slice(14)),
      [value.identifiers[0]],
    );
    const report = value.report();
    assert.equal(report.passed, false);
    assert.equal(report.failures[0].identifier, value.identifiers[0]);
    assert.deepEqual(report.observations, []);
    assert.deepEqual(report.notRun, [value.identifiers[1]]);
    assert.equal(value.calls.filter((call) => call.args[1] === 'keychain').length, 1);
    assert.equal(value.calls.filter((call) => call.args[1] === 'uninstall').length, 1);
  } finally {
    value.dispose();
  }
});

test('cleanup failure preserves the original case failure and withholds all later cases', () => {
  // A failed scoped case must withhold every later selected calendar case.
  for (const scoped of [false, true]) {
    const value = fixture({ cleanupFailure: true, scoped });
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
      const report = value.report();
      assert.equal(report.passed, false);
      assert.equal(report.failures.length, 2);
      assert.equal(report.failures[0].identifier, value.identifiers[0]);
      assert.match(report.failures[0].error, /Original XCTest case failed/);
      assert.equal(report.failures[1].stage, 'cleanup');
      assert.deepEqual(report.notRun, value.identifiers.slice(1));
    } finally {
      value.dispose();
    }
  }
});

test('all successful first cases retain their complete exact observation list', () => {
  const value = fixture({ failFirst: false });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.deepEqual(
      value.report().observations.map((item) => item.identifier),
      value.identifiers,
    );
  } finally {
    value.dispose();
  }
});

test('cleanup failure retains a passed first case and prevents the next fresh case', () => {
  const value = fixture({ failFirst: false, cleanupFailure: true });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
    const report = value.report();
    assert.equal(report.passed, false);
    assert.deepEqual(
      report.observations.map((item) => item.identifier),
      [value.identifiers[0]],
    );
    assert.equal(report.observations[0].result, 'Passed');
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].stage, 'cleanup');
    assert.deepEqual(report.notRun, [value.identifiers[1]]);
    assert.equal(value.calls.filter((call) => call.args[1] === 'keychain').length, 1);
    assert.equal(value.calls.filter((call) => call.args[1] === 'install').length, 1);
  } finally {
    value.dispose();
  }
});

test('scoped cases reuse one installation, reset the exact bundle before each case and clean after failure or group completion', () => {
  for (const failFirst of [true, false]) {
    const value = fixture({ scoped: true, failFirst });
    try {
      assert.equal(value.outcome.status === 0, !failFirst, value.outcome.stderr);
      assert.equal(value.calls.filter((call) => call.args[1] === 'install').length, 1);
      assert.ok(!value.calls.some((call) => ['uninstall', 'keychain'].includes(call.args[1])));
      const privacy = value.calls.filter((call) => call.args[1] === 'privacy');
      // Successful scoped runs reset once per case and once after the group.
      assert.equal(privacy.length, failFirst ? 2 : value.identifiers.length + 1);
      assert.ok(
        privacy.every((call) => call.args.slice(3).join(' ') === 'reset all com.orot.mobile'),
      );
      assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
      assert.equal(value.report().passed, !failFirst);
      assert.deepEqual(value.report().notRun, failFirst ? value.identifiers.slice(1) : []);
    } finally {
      value.dispose();
    }
  }
});
