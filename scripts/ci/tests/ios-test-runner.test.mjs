import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures/ios-test-runner.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('backup mutations cannot run as a shared Core selection or an unsequenced backup suite', () => {
  for (const [profile, selected] of [
    ['core', [iosTestInventory('backup')[0]]],
    ['backup', []],
  ]) {
    const result = fixture(0, profile, 'all', selected);
    try {
      assert.notEqual(result.outcome.status, 0);
      assert.match(result.outcome.stderr, /isolated host-orchestrated phases/);
      assert.ok(!result.calls.some((call) => call.name === 'xcodebuild'));
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  }
  const allowed = fixture(0, 'backup', 'all', [iosTestInventory('backup')[0]]);
  try {
    assert.equal(allowed.outcome.status, 0, allowed.outcome.stderr);
    assert.equal(allowed.calls.filter((call) => call.name === 'xcodebuild').length, 1);
  } finally {
    rmSync(allowed.directory, { recursive: true, force: true });
  }
});

for (const suite of ['integration', 'ui']) {
  test(`executes the mandatory Speech ${suite} inventory once on its own runner`, () => {
    const result = fixture(
      0,
      'speech',
      suite,
      undefined,
      suite === 'ui' ? { OROT_IOS_SPEECH_PHASE: 'ui' } : {},
    );
    try {
      assert.equal(result.outcome.status, 0, result.outcome.stderr);
      const runs = result.calls.filter((call) => call.name === 'xcodebuild');
      assert.equal(runs.length, 1);
      assert.deepEqual(
        runs[0].args.filter((arg) => arg.startsWith('-only-testing:')),
        iosTestInventory('speech', suite).map((id) => '-only-testing:' + id),
      );
      const streams = result.calls.filter(
        (call) => call.name === 'xcrun' && call.args[4] === 'stream',
      );
      assert.equal(streams.length, suite === 'ui' ? 1 : 0);
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  });
}

for (const status of [0, 65]) {
  test(`preserves first test exit ${status} with one runner and bounded failure diagnostics`, () => {
    const result = fixture(status);
    try {
      assert.equal(result.outcome.status, status, result.outcome.stderr);
      const runs = result.calls.filter((call) => call.name === 'xcodebuild');
      assert.equal(runs.length, 1);
      const streams = result.calls.filter(
        ({ name, args }) => name === 'xcrun' && args[1] === 'spawn' && args[4] === 'stream',
      );
      assert.equal(streams.length, 1);
      assert.equal(streams[0].args[2], 'fixture-udid');
      assert.ok(!streams[0].args.includes('--private'));
      const predicate = streams[0].args[streams[0].args.indexOf('--predicate') + 1];
      assert.ok(
        ['testmanagerd', 'FrontBoard', 'RunningBoard'].every((name) => predicate.includes(name)),
      );
      assert.doesNotMatch(predicate, /health|clipboard|OROT_AUTH_DIAGNOSTIC/i);
      const lifecycleLog = readFileSync(result.result + '.lifecycle.log', 'utf8');
      const lifecycleReceipt = JSON.parse(
        readFileSync(result.result + '.lifecycle.log.json', 'utf8'),
      );
      assert.match(lifecycleLog, /TEST_RUNNER_OROT_IOS_TEST_INVOCATION=/);
      assert.equal(lifecycleReceipt.source.invocationId, runs[0].invocation);
      assert.equal(lifecycleReceipt.source.udid, 'fixture-udid');
      assert.equal(lifecycleReceipt.testExitCode, status);
      assert.equal(lifecycleReceipt.dataState, 'captured');
      assert.equal(lifecycleReceipt.truncated, false);
      assert.equal(lifecycleReceipt.stopConfirmed, true);
      assert.equal(runs[0].args[0], 'test-without-building');
      // A slow case remains running; only its outcome or the owning job's cancellation ends it.
      assert.equal(runs[0].args[runs[0].args.indexOf('-test-timeouts-enabled') + 1], 'NO');
      assert.ok(!runs[0].args.includes('-default-test-execution-time-allowance'));
      assert.ok(!runs[0].args.includes('-maximum-test-execution-time-allowance'));
      assert.equal(runs[0].args[runs[0].args.indexOf('-collect-test-diagnostics') + 1], 'never');
      assert.equal(runs[0].args[runs[0].args.indexOf('-parallel-testing-enabled') + 1], 'NO');
      assert.ok(!runs[0].args.some((arg) => arg.includes('retry')));
      const diagnostics = result.calls.filter((call) => call.args.includes('show'));
      assert.equal(diagnostics.length, status === 0 ? 0 : 1);
      if (status !== 0)
        assert.match(readFileSync(result.result + '.app.log', 'utf8'), /fixture app diagnostic/);
      const samples = readFileSync(result.result + '.resources.jsonl', 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.deepEqual(
        samples.map((sample) => sample.stage),
        ['before', 'after'],
      );
      const finalSample = samples.find((sample) => sample.stage === 'after');
      const processSamples = result.calls.filter((call) => call.name === 'ps');
      // Preserve final process output and timing on failure; successful XCTest needs no extra host scan.
      if (status === 0) {
        assert.equal(processSamples.length, 0);
        assert.match(finalSample.observations.processes.unavailable, /test success/);
        assert.equal(finalSample.commandElapsedMs.processes, null);
      } else {
        assert.equal(processSamples.length, 1);
        assert.match(finalSample.observations.processes, /fixture app diagnostic/);
        assert.ok(finalSample.commandElapsedMs.processes > 0);
      }
      assert.match(
        result.outcome.stdout,
        new RegExp(`IOS_TEST_STAGE elapsed_ms=\\d+ exit=${status}`),
      );
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  });
}

for (const status of [0, 65]) {
  test(`an unavailable lifecycle stream cannot replace the first XCTest exit ${status}`, () => {
    const result = fixture(status, 'core', 'all', undefined, {}, 'capture', 'error');
    try {
      assert.equal(result.outcome.status, status, result.outcome.stderr);
      const receipt = JSON.parse(readFileSync(result.result + '.lifecycle.log.json', 'utf8'));
      assert.equal(receipt.testExitCode, status);
      assert.equal(receipt.state, 'unavailable');
      assert.match(receipt.error ?? receipt.stderrTail, /lifecycle stream unavailable/);
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  });
}

test('failure log collection has a finite budget and cannot replace the test exit', () => {
  const source = readFileSync(resolve('scripts/ci/run-ios-tests.mjs'), 'utf8');
  assert.match(source, /timeout: 30000/);
  assert.match(source, /process\.exitCode = status/);
});

test('fresh fixture selections cannot mutate Core or bypass their phase inventory', () => {
  for (const fixtureProfile of ['fixtures', 'health-import', 'microphone', 'provider-selection']) {
    const identifier = iosTestInventory(fixtureProfile)[0];
    for (const [profile, selected] of [
      ['core', [identifier]],
      [fixtureProfile, []],
      [fixtureProfile, [identifier, iosTestInventory(fixtureProfile)[1]]],
      [fixtureProfile, ['OrotUITests/UnknownTests/testUnknown']],
    ]) {
      const result = fixture(0, profile, 'all', selected);
      try {
        assert.notEqual(result.outcome.status, 0);
        assert.match(result.outcome.stderr, /dedicated host-orchestrated destination/);
        assert.ok(!result.calls.some((call) => call.name === 'xcodebuild'));
      } finally {
        rmSync(result.directory, { recursive: true, force: true });
      }
    }
    const allowed = fixture(0, fixtureProfile, 'all', [identifier]);
    try {
      assert.equal(allowed.outcome.status, 0, allowed.outcome.stderr);
      assert.equal(allowed.calls.filter((call) => call.name === 'xcodebuild').length, 1);
    } finally {
      rmSync(allowed.directory, { recursive: true, force: true });
    }
  }
});

test('fresh-install storage refuses shared Core state and runs only as an isolated fixture phase', () => {
  // The original storage requirement resets the app and Keychain before creation, then preserves both only for its in-case restart.
  const identifier =
    'OrotUITests/StorageMigrationUITests/testLegacyEncryptedSchemaReopensThroughAppointmentsAfterProcessRestart';
  const shared = fixture(0, 'core', 'all', [identifier]);
  try {
    assert.notEqual(shared.outcome.status, 0);
    assert.match(shared.outcome.stderr, /dedicated host-orchestrated destination/);
    assert.ok(!shared.calls.some((call) => call.name === 'xcodebuild'));
  } finally {
    rmSync(shared.directory, { recursive: true, force: true });
  }
  const isolated = fixture(0, 'fixtures', 'all', [identifier]);
  try {
    assert.equal(isolated.outcome.status, 0, isolated.outcome.stderr);
    assert.equal(isolated.calls.filter((call) => call.name === 'xcodebuild').length, 1);
  } finally {
    rmSync(isolated.directory, { recursive: true, force: true });
  }
});

test('local model selection requires exactly one corpus phase on its dedicated destination', () => {
  const identifier = iosTestInventory('local-model')[0];
  for (const [profile, selected] of [
    ['core', [identifier]],
    ['local-model', []],
    ['local-model', [identifier, iosTestInventory('local-model')[1]]],
    ['local-model', ['OrotIntegrationTests/UnknownTests/testUnknown']],
  ]) {
    const result = fixture(0, profile, 'all', selected);
    try {
      assert.notEqual(result.outcome.status, 0);
      assert.match(result.outcome.stderr, /isolated corpus and process phases/);
      assert.ok(!result.calls.some((call) => call.name === 'xcodebuild'));
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  }
  const allowed = fixture(65, 'local-model', 'all', [identifier]);
  try {
    assert.equal(allowed.outcome.status, 65, allowed.outcome.stderr);
    assert.equal(allowed.calls.filter((call) => call.name === 'xcodebuild').length, 1);
  } finally {
    rmSync(allowed.directory, { recursive: true, force: true });
  }
});

test('each runner invocation creates a fresh namespace and refuses a mixed ios/UI selection', () => {
  const first = fixture(0);
  const second = fixture(0);
  const mixed = fixture(0, 'core', 'all', [
    ...iosTestInventory('core', 'integration'),
    ...iosTestInventory('core', 'ui'),
  ]);
  try {
    const invocations = [first, second].map((result) => {
      assert.equal(result.outcome.status, 0, result.outcome.stderr);
      const run = result.calls.find((call) => call.name === 'xcodebuild');
      assert.match(
        run.invocation,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      return run.invocation;
    });
    assert.notEqual(invocations[0], invocations[1]);
    assert.notEqual(mixed.outcome.status, 0);
    assert.match(mixed.outcome.stderr, /separate verified invocations/);
    assert.ok(!mixed.calls.some((call) => call.name === 'xcodebuild'));
  } finally {
    for (const result of [first, second, mixed])
      rmSync(result.directory, { recursive: true, force: true });
  }
});
