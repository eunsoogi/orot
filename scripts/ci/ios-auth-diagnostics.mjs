import { spawn } from 'node:child_process';
import { closeSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { parseAuthDiagnosticLine } from './ios-auth-diagnostic-record.mjs';

export const authDiagnosticTest =
  'OrotUITests/ProviderSelectionUITests/testAuthSessionCancellationRouteExitRetryAndCallbackKeepSelectionExplicit';

/** Collect only the original Selection case's opt-in stream, without affecting its result or Simulator services. */
export function startIosAuthDiagnostics(
  udid,
  path,
  { spawnProcess = spawn, stopGraceMs = 2000, maxInputBytes = 1024 * 1024 } = {},
) {
  if (!udid || udid === 'booted') throw new Error('Auth diagnostics require an owned destination');
  if (
    !Number.isInteger(stopGraceMs) ||
    stopGraceMs < 1 ||
    stopGraceMs > 2000 ||
    !Number.isInteger(maxInputBytes) ||
    maxInputBytes < 1 ||
    maxInputBytes > 1024 * 1024
  )
    throw new Error('Invalid auth diagnostic limits');
  const record = {
    udid,
    startedAt: new Date().toISOString(),
    accepted: 0,
    rejected: 0,
    ignored: 0,
    inputBytes: 0,
    stderrBytes: 0,
    truncated: false,
    closed: false,
  };
  let descriptor;
  let child;
  let pending = '';
  let droppingLine = false;
  let forceTimer;
  let finish;
  const completion = new Promise((resolve) => (finish = resolve));
  const stopChild = () => {
    if (!child || record.closed || record.stopRequested) return;
    record.stopRequested = child.kill('SIGTERM');
    // A noisy collector must also stop promptly when a pipe limit is reached before XCTest finishes.
    forceTimer ??= setTimeout(() => {
      if (!record.closed) record.forcedTermination = child.kill('SIGKILL');
    }, stopGraceMs);
    forceTimer.unref();
  };
  const consume = (chunk) => {
    record.inputBytes += chunk.length;
    if (record.inputBytes > maxInputBytes) {
      record.truncated = true;
      stopChild();
      return;
    }
    let text = chunk.toString('utf8');
    if (droppingLine) {
      const end = text.indexOf('\n');
      if (end < 0) return;
      text = text.slice(end + 1);
      droppingLine = false;
    }
    pending += text;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      const parsed = line.length > 8192 ? { status: 'rejected' } : parseAuthDiagnosticLine(line);
      if (parsed.status !== 'accepted') {
        record[parsed.status] += 1;
        continue;
      }
      if (record.accepted >= 64) {
        record.truncated = true;
        stopChild();
        return;
      }
      try {
        const data = Buffer.from(JSON.stringify(parsed.record) + '\n');
        if (writeSync(descriptor, data) !== data.length) throw new Error('incomplete write');
        record.accepted += 1;
      } catch {
        record.error = 'output-write-unavailable';
        stopChild();
      }
    }
    if (pending.length > 8192) {
      record.rejected += 1;
      pending = '';
      droppingLine = true;
    }
  };
  try {
    descriptor = openSync(path, 'wx');
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
        '15m',
        '--predicate',
        'process == "Orot" AND eventMessage BEGINSWITH "OROT_AUTH_DIAGNOSTIC "',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    record.pid = child.pid ?? null;
    child.stdout.on('data', consume);
    const streamFailed = () => {
      record.error = 'collector-stream-unavailable';
      stopChild();
    };
    child.stdout.on('error', streamFailed);
    child.stderr.on('error', streamFailed);
    // Tool errors may echo input. Count stderr without persisting its text.
    child.stderr.on('data', (chunk) => {
      record.stderrBytes += chunk.length;
      if (record.stderrBytes > maxInputBytes) {
        record.truncated = true;
        stopChild();
      }
    });
    child.once('error', () => {
      record.error = 'collector-start-unavailable';
      if (!child.pid) {
        record.closed = true;
        finish();
      }
    });
    child.once('close', (code, signal) => {
      clearTimeout(forceTimer);
      record.closed = true;
      record.exitCode = code;
      record.signal = signal;
      if (pending.length) record.rejected += 1;
      finish();
    });
  } catch {
    record.error =
      descriptor === undefined ? 'output-open-unavailable' : 'collector-start-unavailable';
    record.closed = true;
    finish();
  }
  const waitForClose = () =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, stopGraceMs);
      completion.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  let stopping;
  return () =>
    (stopping ??= (async () => {
      record.exitedBeforeStop = record.closed;
      stopChild();
      await waitForClose();
      if (child && !record.closed) {
        record.forcedTermination ||= child.kill('SIGKILL');
        await waitForClose();
      }
      const expected =
        (record.stopRequested && (record.signal === 'SIGTERM' || record.exitCode === 143)) ||
        (record.forcedTermination && (record.signal === 'SIGKILL' || record.exitCode === 137));
      record.unexpectedExit =
        record.closed && record.exitCode !== undefined && record.exitCode !== 0 && !expected;
      record.complete =
        record.closed &&
        !record.error &&
        !record.truncated &&
        !record.unexpectedExit &&
        !record.exitedBeforeStop &&
        record.rejected === 0 &&
        record.accepted > 0;
      try {
        if (descriptor !== undefined) closeSync(descriptor);
        writeFileSync(path + '.json', JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
      } catch {
        record.persistenceError = 'diagnostic-persistence-unavailable';
      }
      if (!record.complete || record.persistenceError)
        console.error('IOS_AUTH_DIAGNOSTIC_UNAVAILABLE ' + JSON.stringify(record));
      return record;
    })());
}
