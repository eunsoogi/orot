import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createIosSimulatorLifecycleStreamParser } from './ios-simulator-lifecycle-stream-parser.mjs';

const maxProductionBytes = 8 * 1024 * 1024;
const maxRuntime = '90m';
const predicate = [
  '(process == "Orot" AND (subsystem == "com.apple.UIKit" OR subsystem CONTAINS[c] "FrontBoard" OR subsystem CONTAINS[c] "RunningBoard"))',
  '(process == "OrotUITests-Runner" AND (subsystem CONTAINS[c] "XCTest" OR subsystem CONTAINS[c] "FrontBoard"))',
  'process == "testmanagerd"',
  '(process == "SpringBoard" AND (subsystem CONTAINS[c] "FrontBoard" OR subsystem CONTAINS[c] "RunningBoard" OR eventMessage CONTAINS[c] "com.orot.mobile"))',
  '(process == "runningboardd" AND (subsystem CONTAINS[c] "RunningBoard" OR eventMessage CONTAINS[c] "com.orot.mobile"))',
  '(process == "backboardd" AND (subsystem CONTAINS[c] "FrontBoard" OR eventMessage CONTAINS[c] "com.orot.mobile"))',
  '(process == "launchd" AND eventMessage CONTAINS[c] "com.orot.mobile")',
].join(' OR ');

function boundedSource(source) {
  const tests = Array.isArray(source.tests) ? source.tests.slice(0, 128) : [];
  return {
    invocationId: source.invocationId,
    udid: source.udid,
    profile: source.profile,
    tests,
    omittedTests: Math.max(0, (source.tests?.length ?? 0) - tests.length),
    sourceSha: source.sourceSha ?? null,
    runId: source.runId ?? null,
    attempt: source.attempt ?? null,
  };
}

function waitForClose(completion, milliseconds) {
  return Promise.race([completion, new Promise((resolve) => setTimeout(resolve, milliseconds))]);
}

/** Capture privacy-redacted lifecycle logs from one pre-verified Simulator, without owning its services. */
export async function startIosSimulatorLifecycleDiagnostics(
  udid,
  path,
  source,
  {
    spawnProcess = spawn,
    maxBytes = maxProductionBytes,
    startGraceMs = 2000,
    stopGraceMs = 2000,
  } = {},
) {
  if (
    !udid ||
    udid === 'booted' ||
    !path ||
    !source?.invocationId ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > maxProductionBytes ||
    !Number.isInteger(startGraceMs) ||
    startGraceMs < 1 ||
    startGraceMs > 2000 ||
    !Number.isInteger(stopGraceMs) ||
    stopGraceMs < 1 ||
    stopGraceMs > 2000
  )
    throw new Error('Invalid Simulator lifecycle diagnostic inputs or limits');

  const ring = Buffer.alloc(maxBytes);
  const record = {
    schemaVersion: 1,
    source: boundedSource({ ...source, udid }),
    startedAt: new Date().toISOString(),
    maxBytes,
    maxRuntime,
    privacy: 'platform-default-redaction',
    observedBytes: 0,
    capturedBytes: 0,
    stderrBytes: 0,
    stderrTail: '',
    truncated: false,
    dataState: 'no-events',
    state: 'starting',
    streamReady: false,
    startupConfirmed: false,
  };
  let child;
  let position = 0;
  let accepting = true;
  let closed = false;
  let startReturned = false;
  let readinessSettled = false;
  let resolveReadiness;
  let finishClose;
  const readiness = new Promise((resolve) => (resolveReadiness = resolve));
  const completion = new Promise((resolve) => (finishClose = resolve));
  const header = Buffer.from(
    [
      `# TEST_RUNNER_OROT_IOS_TEST_INVOCATION=${record.source.invocationId}`,
      `# simulator_udid=${udid}`,
      `# profile=${record.source.profile}`,
      `# source_sha=${record.source.sourceSha ?? 'unavailable'}`,
      `# run_id=${record.source.runId ?? 'unavailable'} attempt=${record.source.attempt ?? 'unavailable'}`,
      '',
    ].join('\n'),
  );
  const captureEvents = (chunk) => {
    if (!accepting) return;
    const bytes = Buffer.from(chunk);
    record.observedBytes += bytes.length;
    record.truncated ||= record.observedBytes > maxBytes;
    if (bytes.length >= maxBytes) {
      bytes.copy(ring, 0, bytes.length - maxBytes);
      position = 0;
      record.capturedBytes = maxBytes;
      return;
    }
    const first = Math.min(bytes.length, maxBytes - position);
    bytes.copy(ring, position, 0, first);
    if (first < bytes.length) bytes.copy(ring, 0, first);
    position = (position + bytes.length) % maxBytes;
    record.capturedBytes = Math.min(record.observedBytes, maxBytes);
  };
  const settleReadiness = (value) => {
    if (readinessSettled) return;
    readinessSettled = true;
    resolveReadiness(value);
  };
  const capture = createIosSimulatorLifecycleStreamParser({
    onEvents: (chunk) => accepting && captureEvents(chunk),
    onReady: () => {
      record.streamReady = true;
      record.streamReadyAt = new Date().toISOString();
      if (!startReturned) {
        record.startupConfirmed = true;
        record.state = 'streaming';
        settleReadiness(true);
      }
    },
    onStartupOutputTruncated: () => (record.startupOutputTruncated = true),
  });

  try {
    child = spawnProcess(
      'xcrun',
      [
        'simctl',
        'spawn',
        udid,
        'log',
        'stream',
        '--style',
        'compact',
        '--level',
        'info',
        '--timeout',
        maxRuntime,
        '--predicate',
        predicate,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    record.pid = child.pid ?? null;
    child.stdout?.on('data', (chunk) => accepting && capture(chunk));
    child.stderr?.on('data', (chunk) => {
      record.stderrBytes += Buffer.byteLength(chunk);
      record.stderrTail = (record.stderrTail + Buffer.from(chunk).toString()).slice(-2048);
    });
    child.once('error', (error) => {
      record.error = String(error);
      record.state = 'unavailable';
      settleReadiness(false);
    });
    child.once('close', (code, signal) => {
      closed = true;
      record.closedAt = new Date().toISOString();
      record.exitCode = code;
      record.signal = signal;
      if (!record.stopRequested) record.state = 'ended-before-test-result';
      settleReadiness(false);
      finishClose();
    });
    child.once('spawn', () => (record.spawnConfirmed = true));
    await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), startGraceMs);
      readiness.then((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    startReturned = true;
    if (!record.startupConfirmed && !record.error && !closed) record.state = 'start-unconfirmed';
  } catch (error) {
    record.error = String(error);
    record.state = 'unavailable';
  }

  let stopping;
  return (result = {}) =>
    (stopping ??= (async () => {
      Object.assign(
        record,
        Object.fromEntries(
          ['testExitCode', 'testRunnerExitCode', 'fixtureCleanupState']
            .filter((key) => key in result)
            .map((key) => [key, result[key]]),
        ),
      );
      if (child && !closed) {
        record.stopRequested = child.kill('SIGTERM');
        await waitForClose(completion, stopGraceMs);
        if (!closed) {
          record.forcedTermination = child.kill('SIGKILL');
          await waitForClose(completion, stopGraceMs);
        }
      }
      accepting = false;
      record.stopConfirmed = closed;
      record.finishedAt = new Date().toISOString();
      record.dataState = record.observedBytes ? 'captured' : 'no-events';
      const expectedSignal =
        (record.stopRequested && (record.signal === 'SIGTERM' || record.exitCode === 143)) ||
        (record.forcedTermination && (record.signal === 'SIGKILL' || record.exitCode === 137));
      record.unexpectedExit = closed && !record.stopRequested && record.exitCode !== 0;
      if (!closed && child && !record.error) record.state = 'termination-unconfirmed';
      else if (record.error || record.unexpectedExit || (record.exitCode !== 0 && !expectedSignal))
        record.state = 'unavailable';
      else if (!record.spawnConfirmed) record.state = 'unavailable';
      else if (record.startupConfirmed && record.state !== 'ended-before-test-result')
        record.state = 'stopped';
      try {
        const data = record.truncated
          ? Buffer.concat([ring.subarray(position), ring.subarray(0, position)])
          : ring.subarray(0, record.capturedBytes);
        writeFileSync(path, Buffer.concat([header, data]), { flag: 'wx' });
      } catch (error) {
        record.persistenceError = String(error);
        record.state = 'unavailable';
      }
      try {
        writeFileSync(path + '.json', JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
      } catch (error) {
        record.receiptPersistenceError = String(error);
      }
      if (
        record.state === 'unavailable' ||
        record.persistenceError ||
        record.receiptPersistenceError
      )
        console.error('IOS_SIMULATOR_LIFECYCLE_DIAGNOSTIC_UNAVAILABLE ' + JSON.stringify(record));
      return record;
    })());
}
