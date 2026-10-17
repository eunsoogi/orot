import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './fixtures/ios-test-fixture-driver.mjs';

// An uncertain setup must be reported without retrying its mutation as app cleanup.
test('every failed setup stage records the case and remaining inventory without entering a case body or replaying cleanup', () => {
  for (const [scoped, setupFailure] of [
    [false, 'get_app_container'],
    [false, 'keychain'],
    [false, 'install'],
    [true, 'get_app_container'],
    [true, 'install'],
    [true, 'privacy'],
    [true, 'launch'],
    [true, 'terminate'],
  ]) {
    const value = fixture({ scoped, setupFailure, failFirst: false });
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
      const report = value.report();
      assert.equal(report.passed, false);
      assert.equal(report.failures.length, 1);
      assert.equal(report.failures[0].identifier, value.identifiers[0]);
      assert.equal(report.failures[0].stage, 'setup');
      assert.match(
        report.failures[0].error,
        new RegExp('original-' + setupFailure + '-setup-failure'),
      );
      assert.deepEqual(report.observations, []);
      assert.deepEqual(report.notRun, [value.identifiers[1]]);
      assert.equal(
        value.calls.filter(
          (call) =>
            call.args[1] === setupFailure &&
            (setupFailure !== 'get_app_container' || call.args[3] === 'com.orot.mobile'),
        ).length,
        1,
      );
      assert.ok(!value.calls.some((call) => ['shutdown', 'delete'].includes(call.args[1])));
      assert.equal(report.failures[0].cleanup, 'deferred-to-owned-device-cleanup');
    } finally {
      value.dispose();
    }
  }
});

test('a later setup failure retains earlier passed observations and never replays privacy as cleanup', () => {
  const value = fixture({
    scoped: true,
    setupFailure: 'privacy',
    afterFirstCase: true,
    failFirst: false,
  });
  try {
    assert.notEqual(value.outcome.status, 0);
    const report = value.report();
    assert.equal(report.passed, false);
    assert.deepEqual(
      report.observations.map((item) => item.identifier),
      [value.identifiers[0]],
    );
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].identifier, value.identifiers[1]);
    assert.equal(report.failures[0].stage, 'setup');
    assert.deepEqual(report.notRun, []);
    assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
    assert.equal(value.calls.filter((call) => call.args[1] === 'privacy').length, 2);
    assert.equal(value.calls.filter((call) => call.args[1] === 'launch').length, 1);
  } finally {
    value.dispose();
  }
});
