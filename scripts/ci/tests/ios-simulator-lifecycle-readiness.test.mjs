import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startIosSimulatorLifecycleDiagnostics } from '../ios-simulator-lifecycle-diagnostics.mjs';
import { createIosSimulatorLifecycleStreamParser } from '../ios-simulator-lifecycle-stream-parser.mjs';
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

test('recognizes a coalesced startup header before bounding event bytes', () => {
  const events =
    Array.from(
      { length: 80 },
      (_, index) =>
        `2026-10-24 12:00:00.000 Df Orot[123:456] Scene update lifecycle event ${String(index).padStart(2, '0')}`,
    ).join('\n') + '\n';
  const input = Buffer.from(streamHeader + events);
  let ready = false;
  let startupOutputTruncated = false;
  const captured = [];
  const parse = createIosSimulatorLifecycleStreamParser({
    onEvents: (chunk) => captured.push(Buffer.from(chunk)),
    onReady: () => (ready = true),
    onStartupOutputTruncated: () => (startupOutputTruncated = true),
  });

  assert.ok(input.length > 4096);
  parse(input);

  assert.equal(ready, true);
  assert.equal(startupOutputTruncated, false);
  assert.equal(Buffer.concat(captured).toString('utf8'), events);
});

test('preserves a multibyte event split across the readiness transition', () => {
  const events = Buffer.from(
    '2026-10-24 12:00:00.000 Df Orot[123:456] Scene 한국어 lifecycle event\n',
  );
  const koreanOffset = events.indexOf(Buffer.from('한'));
  const splitOffset = koreanOffset + 1;
  let ready = false;
  const captured = [];
  const parse = createIosSimulatorLifecycleStreamParser({
    onEvents: (chunk) => captured.push(Buffer.from(chunk)),
    onReady: () => (ready = true),
    onStartupOutputTruncated: () => assert.fail('startup data should not be truncated'),
  });

  assert.ok(koreanOffset >= 0);
  parse(Buffer.concat([Buffer.from(streamHeader), events.subarray(0, splitOffset)]));
  parse(events.subarray(splitOffset));

  assert.equal(ready, true);
  assert.deepEqual(Buffer.concat(captured), events);
});

test('recognizes a header split across startup chunks and preserves CRLF events', () => {
  const headerPrefix = Buffer.from('Filtering the log data using (true)\nTimestamp               ');
  const headerSuffix = Buffer.from('Ty Process[PID:TID]\r');
  const events = Buffer.from('2026-10-24 12:00:00.000 Df Orot[123:456] Scene ready\r\n');
  let ready = false;
  const captured = [];
  const parse = createIosSimulatorLifecycleStreamParser({
    onEvents: (chunk) => captured.push(Buffer.from(chunk)),
    onReady: () => (ready = true),
    onStartupOutputTruncated: () => assert.fail('split startup should remain bounded'),
  });

  parse(headerPrefix);
  assert.equal(ready, false);
  parse(headerSuffix);
  assert.equal(ready, false);
  parse(Buffer.from('\n'));
  assert.equal(ready, true);
  parse(events);

  assert.deepEqual(Buffer.concat(captured), events);
});

test('does not recognize a header prefix that begins mid-line after startup data exceeds its bound', () => {
  const falseHeader = Buffer.from('Timestamp Ty Process[PID:TID]');
  const overlongLine = Buffer.concat([
    Buffer.from('x'),
    falseHeader,
    Buffer.alloc(4097 - falseHeader.length - 1, 0x61),
  ]);
  const events = Buffer.from('2026-10-24 12:00:00.000 Df Orot[123:456] Scene ready\n');
  let ready = false;
  let startupOutputTruncated = false;
  const captured = [];
  const parse = createIosSimulatorLifecycleStreamParser({
    onEvents: (chunk) => captured.push(Buffer.from(chunk)),
    onReady: () => (ready = true),
    onStartupOutputTruncated: () => (startupOutputTruncated = true),
  });

  assert.equal(overlongLine.length, 4097);
  parse(overlongLine);
  parse(Buffer.from('\n'));

  assert.equal(ready, false);
  assert.equal(startupOutputTruncated, true);

  parse(Buffer.concat([Buffer.from(streamHeader.split('\n')[1] + '\n'), events]));

  assert.equal(ready, true);
  assert.deepEqual(Buffer.concat(captured), events);
});

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
