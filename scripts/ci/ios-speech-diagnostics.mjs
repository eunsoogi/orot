import { spawn } from 'node:child_process';
import { closeSync, openSync, readSync, writeFileSync, writeSync } from 'node:fs';

const assetProcesses = [
  'mobileassetd',
  'managedassetsd',
  'jetpackassetd',
  'corespeechd',
  'localspeechrecognition',
];
const predicate = [
  '(process == "Orot" AND eventMessage CONTAINS "OROT_SPEECH")',
  ...assetProcesses.map((name) => `process == "${name}"`),
].join(' OR ');

/** Stream public logs from the already verified owned Simulator before Speech setup.
 * These process names were observed in the failed runner; absence of logs is not proof of a healthy service.
 * Stop only this newly spawned collector. Never change logging privacy or terminate a system service.
 */
export function startIosSpeechDiagnostics(
  udid,
  path,
  { spawnProcess = spawn, maxBytes = 8 * 1024 * 1024, stopGraceMs = 2000 } = {},
) {
  if (!udid || udid === 'booted')
    throw new Error('Speech diagnostics require the owned destination');
  // Tests may tighten these limits; no caller can expand the production collector budget.
  if (
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 8 * 1024 * 1024 ||
    !Number.isInteger(stopGraceMs) ||
    stopGraceMs < 1 ||
    stopGraceMs > 2000
  )
    throw new Error('Invalid Speech diagnostic limits');
  const record = {
    udid,
    startedAt: new Date().toISOString(),
    capturedBytes: 0,
    observedBytes: 0,
    truncated: false,
  };
  let descriptor;
  try {
    descriptor = openSync(path, 'wx+');
  } catch (error) {
    record.error = String(error);
    console.error('IOS_SPEECH_DIAGNOSTIC_UNAVAILABLE ' + JSON.stringify(record));
    return async () => record;
  }
  let child;
  let closed = false;
  let accepting = true;
  let position = 0;
  let closeResult;
  const completion = new Promise((resolve) => (closeResult = resolve));
  const finish = () => {
    closed = true;
    closeResult();
  };
  const capture = (chunk) => {
    if (!accepting) return;
    record.firstDataAt ??= new Date().toISOString();
    const bytes = Buffer.from(chunk);
    record.observedBytes += bytes.length;
    try {
      // Keep a bounded ring on disk so a long app-host startup cannot discard the eventual failure.
      const tail = bytes.subarray(Math.max(0, bytes.length - maxBytes));
      if (bytes.length >= maxBytes) position = 0;
      const first = Math.min(tail.length, maxBytes - position);
      if (writeSync(descriptor, tail, 0, first, position) !== first)
        throw new Error('Incomplete Speech diagnostic write');
      const rest = tail.length - first;
      if (rest && writeSync(descriptor, tail, first, rest, 0) !== rest)
        throw new Error('Incomplete Speech diagnostic write');
      position = (position + tail.length) % maxBytes;
      record.capturedBytes = Math.min(record.observedBytes, maxBytes);
      record.truncated = record.observedBytes > maxBytes;
    } catch (error) {
      record.error = String(error);
      accepting = false;
      record.stopRequested = child.kill('SIGTERM');
      return;
    }
  };
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
        '90m',
        '--predicate',
        predicate,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    record.pid = child.pid ?? null;
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => {
      record.error = String(error);
      if (!child.pid) finish();
    });
    child.once('close', (code, signal) => {
      record.exitCode = code;
      record.signal = signal;
      record.closedAt = new Date().toISOString();
      finish();
    });
  } catch (error) {
    record.error = String(error);
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
      if (!closed) {
        record.stopRequested = child.kill('SIGTERM') || record.stopRequested;
        await waitForClose();
      }
      if (!closed) {
        record.forcedTermination = child.kill('SIGKILL');
        await waitForClose();
      }
      accepting = false;
      if (!closed) {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
      }
      // An unavailable, truncated or unconfirmed collector is diagnostic evidence, never a replacement test result.
      record.closed = closed;
      record.finishedAt = new Date().toISOString();
      // simctl can report a requested signal as 128 + signal instead of Node's signal field.
      const expectedTermination =
        (record.stopRequested && (record.signal === 'SIGTERM' || record.exitCode === 143)) ||
        (record.forcedTermination && (record.signal === 'SIGKILL' || record.exitCode === 137));
      record.unexpectedExit =
        closed && !record.error && record.exitCode !== 0 && !expectedTermination;
      try {
        if (record.truncated && position) {
          const ring = Buffer.alloc(record.capturedBytes);
          if (readSync(descriptor, ring, 0, ring.length, 0) !== ring.length)
            throw new Error('Incomplete Speech diagnostic read');
          const ordered = Buffer.concat([ring.subarray(position), ring.subarray(0, position)]);
          if (writeSync(descriptor, ordered, 0, ordered.length, 0) !== ordered.length)
            throw new Error('Incomplete Speech diagnostic finalization');
        }
      } catch (error) {
        record.persistenceError = String(error);
      }
      try {
        closeSync(descriptor);
        writeFileSync(path + '.json', JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
      } catch (error) {
        record.persistenceError = String(error);
      }
      if (record.error || record.persistenceError || !closed || record.unexpectedExit)
        console.error('IOS_SPEECH_DIAGNOSTIC_UNAVAILABLE ' + JSON.stringify(record));
      return record;
    })());
}
