import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyBackupOwner } from '../ios-test-backup-state-diagnostics.mjs';

const owner = {
  profile: 'backup',
  runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
  device: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
  name: 'owned-backup-fixture',
  udid: '11111111-2222-4333-8444-555555555555',
};
const source = {
  runId: '987654321',
  attempt: '7',
  sourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

function tempReceipt() {
  const directory = mkdtempSync(join(tmpdir(), 'orot-backup-state-'));
  return {
    directory,
    path: join(directory, 'backup-state-failures.jsonl'),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function readReceipt(path) {
  return JSON.parse(readFileSync(path, 'utf8').trim());
}

test('records the rejected state, exact phase, verified owner, host interval, guest collector and cleanup state', () => {
  const receipt = tempReceipt();
  const guest = join(receipt.directory, '04.xcresult.lifecycle.log.json');
  writeFileSync(
    guest,
    JSON.stringify({
      state: 'start-unconfirmed',
      dataState: 'captured',
      streamReady: true,
      startupConfirmed: false,
      observedBytes: 120,
      capturedBytes: 120,
      truncated: false,
      stopRequested: true,
      forcedTermination: true,
      stopConfirmed: true,
      unexpectedExit: false,
      signal: 'SIGKILL',
    }),
  );
  let collected;
  try {
    assert.throws(
      () =>
        verifyBackupOwner({
          owner,
          phase: 'snapshot',
          source,
          diagnosticPath: receipt.path,
          lifecycleReceiptPath: guest,
          verify(_owner, _profile, { onInventory }) {
            onInventory({
              observedAt: '2026-10-24T04:58:30.945Z',
              runtime: { identifier: owner.runtime, isAvailable: true },
              device: {
                udid: owner.udid,
                name: owner.name,
                deviceTypeIdentifier: owner.device,
                state: 'Shutdown',
              },
            });
            return { state: 'Shutdown' };
          },
          collectHostLogs(input) {
            collected = input;
            return {
              status: 'captured',
              window: { start: '2026-10-24T04:57:30.945Z', end: '2026-10-24T04:58:30.945Z' },
              events: [
                { timestamp: '2026-10-24T04:58:30.100Z', eventMessage: `Shutdown ${owner.udid}` },
              ],
            };
          },
        }),
      /Backup execution requires its booted dedicated destination/,
    );
    const result = readReceipt(receipt.path);
    assert.equal(result.source.runId, source.runId);
    assert.equal(result.source.attempt, source.attempt);
    assert.equal(result.source.sourceSha, source.sourceSha);
    assert.equal(result.phase.name, 'snapshot');
    assert.equal(result.phase.inventoryObservedAt, '2026-10-24T04:58:30.945Z');
    assert.equal(result.ownerIdentity.status, 'verified');
    assert.equal(result.observed.state, 'Shutdown');
    assert.equal(result.observed.stateStatus, 'observed');
    assert.equal(result.observed.stateScope, 'owned-destination');
    assert.equal(result.hostLifecycle.status, 'captured');
    assert.deepEqual(collected, { udid: owner.udid, observedAt: '2026-10-24T04:58:30.945Z' });
    assert.equal(result.guestCollector.state, 'start-unconfirmed');
    assert.equal(result.guestCollector.forcedTermination, true);
    assert.equal(result.guestCollector.signal, 'SIGKILL');
    assert.deepEqual(result.repositoryCleanup, { status: 'not-started' });
  } finally {
    receipt.dispose();
  }
});

test('records an ownership mismatch without collecting another destination and rethrows the original error', () => {
  const receipt = tempReceipt();
  const mismatch = new Error('iOS simulator ownership mismatch');
  let collected = false;
  try {
    assert.throws(
      () =>
        verifyBackupOwner({
          owner,
          phase: 'restore',
          source,
          diagnosticPath: receipt.path,
          verify(_owner, _profile, { onInventory }) {
            onInventory({
              observedAt: '2026-10-24T04:58:31.000Z',
              runtime: { identifier: owner.runtime, isAvailable: true },
              device: {
                udid: owner.udid,
                name: 'unexpected-name',
                deviceTypeIdentifier: owner.device,
                state: 'Shutdown',
              },
            });
            throw mismatch;
          },
          collectHostLogs() {
            collected = true;
            return { status: 'captured', events: [] };
          },
        }),
      (error) => error === mismatch,
    );
    const result = readReceipt(receipt.path);
    assert.equal(result.ownerIdentity.status, 'mismatch');
    assert.equal(result.ownerIdentity.nameMatches, false);
    assert.equal(result.observed.state, 'Shutdown');
    assert.equal(result.observed.stateScope, 'unverified-candidate');
    assert.deepEqual(result.hostLifecycle, {
      status: 'unavailable',
      reason: 'owner-unverified',
      privacy: 'platform-default-redaction',
    });
    assert.equal(collected, false);
  } finally {
    receipt.dispose();
  }
});

test('diagnostic collection and write failures never replace the original Booted-guard error', () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-backup-diagnostic-failure-'));
  const unavailableReceipt = join(root, 'missing', 'receipt.jsonl');
  try {
    assert.throws(
      () =>
        verifyBackupOwner({
          owner,
          phase: 'snapshot',
          source,
          diagnosticPath: unavailableReceipt,
          verify: () => ({ state: 'Shutdown' }),
          collectHostLogs: () => {
            throw new Error('synthetic host-log failure');
          },
        }),
      /Backup execution requires its booted dedicated destination/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('records a collector failure as unavailable without replacing the guard or its status', () => {
  const receipt = tempReceipt();
  try {
    assert.throws(
      () =>
        verifyBackupOwner({
          owner,
          phase: 'snapshot',
          source,
          diagnosticPath: receipt.path,
          verify: () => ({ state: 'Shutdown' }),
          collectHostLogs: () => {
            const error = new Error('synthetic timeout');
            error.code = 'ETIMEDOUT';
            throw error;
          },
        }),
      /Backup execution requires its booted dedicated destination/,
    );
    const result = readReceipt(receipt.path);
    assert.equal(result.hostLifecycle.status, 'unavailable');
    assert.equal(result.hostLifecycle.reason, 'collector-failed');
    assert.equal(result.hostLifecycle.diagnosticOutcome.errorCode, 'ETIMEDOUT');
  } finally {
    receipt.dispose();
  }
});
