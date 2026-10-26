import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { commandFixture } from './fixtures/ios-fixture-command.mjs';

test('scoped preparation accepts an actual successful child beyond thirty seconds without consuming receipt time', () => {
  const value = commandFixture({ slowPrivacy: true });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.equal(value.result.passed, true);
    assert.ok(value.result.result.preparationElapsedMs >= 31000);
    assert.ok(value.result.result.receiptElapsedMs < 10000);
    assert.equal(value.calls.filter((args) => args[1] === 'privacy').length, 1);
    assert.equal(value.calls.filter((args) => args[1] === 'launch').length, 1);
    assert.equal(value.calls.filter((args) => args[1] === 'terminate').length, 1);
  } finally {
    value.dispose();
  }
});

test('the original failed receipt remains primary when termination also fails', () => {
  const value = commandFixture({ invalidReceipt: true, terminateFailure: true });
  try {
    assert.equal(value.outcome.status, 1);
    assert.equal(value.result.passed, false);
    assert.match(value.result.message, /Missing, stale or failed scoped fixture receipt/);
    assert.match(value.outcome.stderr, /secondary-terminate-failure/);
    assert.equal(value.calls.filter((args) => args[1] === 'launch').length, 1);
    assert.equal(value.calls.filter((args) => args[1] === 'terminate').length, 1);
  } finally {
    value.dispose();
  }
});

test('receipt failure alone and cleanup failure alone both fail without replaying a command', () => {
  for (const [options, expected] of [
    [{ invalidReceipt: true }, /Missing, stale or failed scoped fixture receipt/],
    [{ terminateFailure: true }, /secondary-terminate-failure/],
  ]) {
    const value = commandFixture(options);
    try {
      assert.equal(value.outcome.status, 1);
      assert.match(value.result.message, expected);
      assert.equal(value.calls.filter((args) => args[1] === 'launch').length, 1);
      assert.equal(value.calls.filter((args) => args[1] === 'terminate').length, 1);
    } finally {
      value.dispose();
    }
  }
});

test('nonzero privacy status or lost ownership stops before launch and cleanup mutation', () => {
  for (const [options, message] of [
    [{ privacyFailure: true }, /original-privacy-failure/],
    [{ loseOwnership: true }, /ownership mismatch/],
  ]) {
    const value = commandFixture(options);
    try {
      assert.equal(value.outcome.status, 1);
      assert.match(value.result.message, message);
      assert.equal(value.calls.filter((args) => args[1] === 'privacy').length, 1);
      assert.ok(!value.calls.some((args) => ['launch', 'terminate'].includes(args[1])));
    } finally {
      value.dispose();
    }
  }
});

test('receipt stays unconsumed when fresh ownership or boot verification fails at completion', () => {
  for (const [options, message] of [
    [{ loseOwnershipAtReceipt: true }, /iOS simulator ownership mismatch/],
    [{ loseBootAtReceipt: true }, /Fixture destination stopped before its receipt/],
  ]) {
    const value = commandFixture(options);
    try {
      assert.equal(value.outcome.status, 1);
      assert.match(value.result.message, message);
      assert.equal(existsSync(value.receiptPath), true);
      assert.equal(value.calls.filter((args) => args[1] === 'launch').length, 1);
      assert.ok(!value.calls.some((args) => args[1] === 'terminate'));
    } finally {
      value.dispose();
    }
  }
});
