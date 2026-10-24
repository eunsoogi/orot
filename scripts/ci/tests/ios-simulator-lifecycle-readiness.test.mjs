import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startIosSimulatorLifecycleDiagnostics } from '../ios-simulator-lifecycle-diagnostics.mjs';
import { fixture } from './fixtures/ios-test-runner.mjs';

const source = {
  invocationId: '00000000-0000-4000-8000-000000000001',
  profile: 'core',
  tests: ['OrotUITests/LaunchTests/testLaunch'],
  sourceSha: 'abc123',
  runId: '42',
  attempt: '2',
};
const streamHeader =
  'Filtering the log data using (true)\nTimestamp               Ty Process[PID:TID]\n';

async function collect(program, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-lifecycle-readiness-'));
  const path = join(directory, 'lifecycle.log');
  const stop = await startIosSimulatorLifecycleDiagnostics('owned-udid', path, source, {
    ...options,
    spawnProcess: (command, args, settings) => spawn(process.execPath, ['-e', program], settings),
  });
  return { directory, path, stop };
}

test('does not count the log stream banner or column heading as captured events', async () => {
  const value = await collect(
    `process.stdout.write(${JSON.stringify(streamHeader)});setInterval(()=>{},1000)`,
    { maxBytes: 16 },
  );
  try {
    const record = await value.stop({ testExitCode: 0 });
    const log = readFileSync(value.path, 'utf8');
    assert.equal(record.streamReady, true);
    assert.equal(record.startupConfirmed, true);
    assert.equal(record.observedBytes, 0);
    assert.equal(record.truncated, false);
    assert.equal(record.dataState, 'no-events');
    assert.doesNotMatch(log, /Filtering the log data|Timestamp\s+Ty Process/);
  } finally {
    await value.stop();
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('bounds an unconfirmed stream start and preserves the XCTest result', async () => {
  const value = await collect('setInterval(()=>{},1000)', { startGraceMs: 25 });
  try {
    const record = await value.stop({ testExitCode: 65 });
    assert.equal(record.startupConfirmed, false);
    assert.equal(record.streamReady, false);
    assert.equal(record.state, 'start-unconfirmed');
    assert.equal(record.dataState, 'no-events');
    assert.equal(record.testExitCode, 65);
  } finally {
    await value.stop();
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('preserves an early stream exit as distinct from an unconfirmed startup timeout', async () => {
  const value = await collect('process.exit(0)', { startGraceMs: 250 });
  try {
    const record = await value.stop({ testExitCode: 65 });
    assert.equal(record.startupConfirmed, false);
    assert.equal(record.state, 'ended-before-test-result');
    assert.equal(record.testExitCode, 65);
    assert.equal(record.stopConfirmed, true);
  } finally {
    await value.stop();
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('waits for delayed log stream startup but not for the first lifecycle event', () => {
  const result = fixture(0, 'core', 'all', undefined, {}, 'capture', 'delayed');
  try {
    assert.equal(result.outcome.status, 0, result.outcome.stderr);
    assert.equal(
      readFileSync(join(result.directory, 'xcode-before-lifecycle-ready'), 'utf8'),
      'false',
    );
    assert.equal(
      readFileSync(join(result.directory, 'xcode-before-lifecycle-event'), 'utf8'),
      'true',
    );
    const receipt = JSON.parse(readFileSync(result.result + '.lifecycle.log.json', 'utf8'));
    assert.equal(receipt.streamReady, true);
    assert.equal(receipt.startupConfirmed, true);
    assert.equal(receipt.dataState, 'no-events');
  } finally {
    rmSync(result.directory, { recursive: true, force: true });
  }
});
