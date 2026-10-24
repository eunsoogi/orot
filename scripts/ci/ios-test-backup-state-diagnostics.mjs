import { appendFileSync, readFileSync } from 'node:fs';
import { iosPreparationFailure } from './ios-test-preparation-diagnostics.mjs';
import { collectBackupHostLifecycle } from './ios-test-backup-host-lifecycle.mjs';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';

function shortString(value, max = 160) {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function unavailable(reason) {
  return { status: 'unavailable', reason };
}

function candidateIdentity(owner, observation) {
  const device = observation?.device;
  const runtime = observation?.runtime;
  const result = {
    udidMatches: device?.udid === owner.udid,
    nameMatches: device?.name === owner.name,
    deviceTypeMatches: device?.deviceTypeIdentifier === owner.device,
    runtimeMatches:
      runtime?.identifier === owner.runtime &&
      runtime?.isAvailable === true &&
      (runtime.approvedBuild == null || runtime.buildversion === runtime.approvedBuild),
  };
  return {
    ...result,
    matches: Object.values(result).every(Boolean),
  };
}

function guestCollector(path) {
  if (!path) return unavailable('no-prior-guest-receipt');
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return unavailable('guest-receipt-missing-or-unreadable');
  }
  const fields = [
    'state',
    'dataState',
    'streamReady',
    'startupConfirmed',
    'observedBytes',
    'capturedBytes',
    'truncated',
    'startedAt',
    'streamReadyAt',
    'closedAt',
    'finishedAt',
    'stopRequested',
    'forcedTermination',
    'stopConfirmed',
    'unexpectedExit',
    'exitCode',
    'signal',
    'testExitCode',
  ];
  return Object.fromEntries(
    fields.filter((field) => field in receipt).map((field) => [field, receipt[field]]),
  );
}

/** Keep a Backup owner-state failure and its original error independent of diagnostic outcomes. */
export function verifyBackupOwner({
  owner,
  phase,
  source,
  diagnosticPath,
  lifecycleReceiptPath,
  verify = verifyIosTestSimulator,
  collectHostLogs = collectBackupHostLifecycle,
  append = appendFileSync,
  now = () => new Date(),
}) {
  const phaseStartedAt = now().toISOString();
  let observation;
  let ownerVerified = false;
  try {
    const device = verify(owner, 'backup', {
      onInventory: (value) => (observation = value),
    });
    ownerVerified = true;
    if (!observation)
      observation = {
        observedAt: now().toISOString(),
        runtime: { identifier: owner.runtime, isAvailable: true },
        device: {
          udid: owner.udid,
          name: owner.name,
          deviceTypeIdentifier: owner.device,
          state: device.state,
        },
      };
    if (device.state !== 'Booted')
      throw new Error('Backup execution requires its booted dedicated destination');
    return device;
  } catch (error) {
    try {
      const failureObservedAt = now().toISOString();
      const candidate = candidateIdentity(owner, observation);
      const identityStatus = ownerVerified
        ? 'verified'
        : candidate.udidMatches && (!candidate.nameMatches || !candidate.deviceTypeMatches)
          ? 'mismatch'
          : 'unverified';
      const inventoryObservedAt = shortString(observation?.observedAt, 48);
      let hostLifecycle = {
        ...unavailable('owner-unverified'),
        privacy: 'platform-default-redaction',
      };
      if (identityStatus === 'verified') {
        try {
          hostLifecycle = collectHostLogs({ udid: owner.udid, observedAt: inventoryObservedAt });
        } catch (diagnosticError) {
          hostLifecycle = {
            ...unavailable('collector-failed'),
            diagnosticOutcome: iosPreparationFailure(diagnosticError),
            privacy: 'platform-default-redaction',
          };
        }
      }
      const record = {
        schemaVersion: 1,
        source: {
          runId: shortString(source?.runId),
          attempt: shortString(source?.attempt),
          sourceSha: shortString(source?.sourceSha, 64),
        },
        phase: {
          name: shortString(phase),
          startedAt: phaseStartedAt,
          inventoryObservedAt,
          failureObservedAt,
        },
        ownerIdentity: {
          status: identityStatus,
          udid: shortString(owner.udid),
          name: shortString(owner.name),
          deviceTypeIdentifier: shortString(owner.device),
          runtime: shortString(owner.runtime),
          ...candidate,
        },
        observed: {
          state: shortString(observation?.device?.state, 64),
          stateStatus: typeof observation?.device?.state === 'string' ? 'observed' : 'unknown',
          stateScope:
            identityStatus === 'verified'
              ? 'owned-destination'
              : observation?.device
                ? 'unverified-candidate'
                : 'unknown',
        },
        hostLifecycle,
        guestCollector: guestCollector(lifecycleReceiptPath),
        repositoryCleanup: { status: 'not-started' },
      };
      console.error('IOS_BACKUP_STATE_DIAGNOSTIC ' + JSON.stringify(record));
      if (diagnosticPath) append(diagnosticPath, JSON.stringify(record) + '\n');
    } catch (diagnosticError) {
      console.error(
        'IOS_BACKUP_STATE_DIAGNOSTIC ' +
          JSON.stringify({
            event: 'diagnostic-write-failed',
            ...iosPreparationFailure(diagnosticError),
          }),
      );
    }
    throw error;
  }
}
