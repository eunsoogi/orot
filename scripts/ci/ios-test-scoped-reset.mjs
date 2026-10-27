import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { verifyIosSimulatorOwnerContract } from './ios-test-cohorts.mjs';
import { runIosSimulatorCommand, verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { verifyIosFixtureReceipt } from './ios-test-fixture-receipt.mjs';
export { verifyIosFixtureReceipt } from './ios-test-fixture-receipt.mjs';
import {
  iosPreparationFailure,
  recordIosPreparationDiagnostic,
} from './ios-test-preparation-diagnostics.mjs';

const bundle = 'com.orot.mobile';
/** Future cases default to full installation isolation until their actual state boundary is classified. */
export function iosFixtureResetMode(profile, identifier) {
  const scopedClasses = [
    'AiFeatureNavigationUITests',
    'SafeAreaNavigationUITests',
    'RootNavigationUITests',
    'RecordingLibraryUITests',
    'RecordingPlaybackUITests',
    'UnifiedImportUITests',
    'NextVisitReviewUITests',
    'KeyboardSafeAreaUITests',
    'PagedHealthRecordsUITests',
    'HealthImportUITests',
    'AppointmentConsentUITests',
    'VisitQuestionConsentUITests',
    'AppointmentsUITests',
    'CalendarSelectionUITests',
    'ScheduleCalendarUITests',
  ];
  return profile === 'fixtures' && scopedClasses.includes(identifier.split('/')[1])
    ? 'scoped'
    : 'fresh-install';
}

/** Exact Orot container lookups check the recorded profile; every state change still checks live ownership. */
export function ownedFixtureCommand(profile, owner, args) {
  if (!['fixtures', 'core'].includes(profile))
    throw new Error(
      'Scoped fixture commands require an owned booted fixture or isolation destination',
    );
  const readsOwnedContainer =
    args.length === 4 &&
    args[0] === 'get_app_container' &&
    typeof owner.udid === 'string' &&
    owner.udid.length > 0 &&
    args[1] === owner.udid &&
    args[2] === bundle &&
    ['app', 'data'].includes(args[3]);
  if (readsOwnedContainer) {
    // This only resolves the exact recorded device and Orot container; receipt acceptance and mutations keep live checks.
    verifyIosSimulatorOwnerContract(owner, profile);
  } else if (verifyIosTestSimulator(owner, profile).state !== 'Booted') {
    throw new Error(
      'Scoped fixture commands require an owned booted fixture or isolation destination',
    );
  }
  return runIosSimulatorCommand(args).trim();
}

/** One read-only observation shares five seconds across fresh ownership and container lookup.
 * SIGKILL bounds only this optional observation; ordinary installation awaits its actual command exit.
 * An installed result after a failed install is evidence only and never resumes reset or XCTest. */
function observeFailedInstall(profile, owner) {
  const started = performance.now();
  const deadline = started + 5000;
  let stage = 'ownership';
  const options = () => {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0)
      throw Object.assign(new Error('Diagnostic deadline exceeded'), { code: 'ETIMEDOUT' });
    return { timeout: remaining, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] };
  };
  let observation;
  try {
    if (
      !['core', 'fixtures'].includes(profile) ||
      verifyIosTestSimulator(owner, profile, options()).state !== 'Booted'
    )
      throw new Error('Diagnostic ownership unavailable');
    stage = 'container';
    const path = runIosSimulatorCommand(
      ['get_app_container', owner.udid, bundle, 'app'],
      options(),
    ).trim();
    observation = { state: isAbsolute(path) ? 'installed' : 'unknown' };
  } catch (error) {
    const absent =
      stage === 'container' &&
      error.status === 2 &&
      String(error.stderr).includes('domain=NSPOSIXErrorDomain, code=2');
    observation = { state: absent ? 'absent' : 'unknown', ...iosPreparationFailure(error) };
  }
  const elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;
  if (elapsedMs >= 5000) observation = { ...observation, state: 'unknown', errorCode: 'ETIMEDOUT' };
  recordIosPreparationDiagnostic({
    event: 'install-post-state',
    stage,
    budgetMs: 5000,
    elapsedMs,
    ...observation,
  });
}

/** Reuse the verified installed product; only an absent owned bundle needs installation. */
export function ensureIosFixtureInstalled(profile, owner, application) {
  try {
    const path = ownedFixtureCommand(profile, owner, [
      'get_app_container',
      owner.udid,
      bundle,
      'app',
    ]);
    if (!isAbsolute(path)) throw new Error('Fixture application container must be absolute');
  } catch (error) {
    if (error.status !== 2 || !String(error.stderr).includes('domain=NSPOSIXErrorDomain, code=2'))
      throw error;
    try {
      ownedFixtureCommand(profile, owner, ['install', owner.udid, application]);
    } catch (installError) {
      recordIosPreparationDiagnostic({
        event: 'install-failed',
        ...iosPreparationFailure(installError),
      });
      try {
        observeFailedInstall(profile, owner);
      } catch (diagnosticError) {
        // An unexpected observation failure cannot replace the original install outcome.
        recordIosPreparationDiagnostic({
          event: 'install-diagnostic-failed',
          ...iosPreparationFailure(diagnosticError),
        });
      }
      throw installError;
    }
  }
}

/** A test-only cold launch resets before React starts; the receipt is read directly from this app's public container. */
export async function runIosFixtureCommand(profile, owner, action, token = randomUUID()) {
  const started = Date.now();
  if (
    !['reset', 'seed', 'inspect'].includes(action) ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(token)
  )
    throw new Error('Invalid scoped fixture action or token');
  const command = (...args) => ownedFixtureCommand(profile, owner, args);
  const container = command('get_app_container', owner.udid, bundle, 'data');
  if (!isAbsolute(container)) throw new Error('Scoped fixture data container must be absolute');
  const receiptPath = join(
    container,
    'Library',
    'Caches',
    'OrotFixtureReceipts',
    `${token}-${action}.json`,
  );
  if (existsSync(receiptPath))
    throw new Error('Scoped fixture command refuses an existing receipt');
  if (action === 'reset') command('privacy', owner.udid, 'reset', 'all', bundle);
  const launchOutput = command(
    'launch',
    '--terminate-running-process',
    owner.udid,
    bundle,
    '--orot-fixture-command',
    action,
    token,
  );
  const launched = Date.now();
  let failure;
  let result;
  try {
    // simctl launch returns the actual host PID. A live owned app may finish slowly;
    // process exit or ownership loss fails instead of manufacturing a receipt or relaunching.
    const match = /^com\.orot\.mobile:\s+(\d+)\s*$/m.exec(launchOutput);
    const pid = Number(match?.[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid fixture launch PID');
    while (!existsSync(receiptPath)) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        throw new Error('Scoped fixture process exited before its receipt', { cause: error });
      }
      await setTimeout(50);
    }
    // Keep the wait loop on local state; a full inventory blocks receipt and PID checks.
    // Fresh ownership remains required before consuming the receipt and every mutation.
    if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
      throw new Error('Fixture destination stopped before its receipt');
    const receipt = verifyIosFixtureReceipt(
      JSON.parse(readFileSync(receiptPath, 'utf8')),
      action,
      token,
    );
    if (receipt.processIdentifier !== pid) throw new Error('Fixture receipt process mismatch');
    unlinkSync(receiptPath);
    result = {
      ...receipt,
      preparationElapsedMs: launched - started,
      receiptElapsedMs: Date.now() - launched,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    failure = error;
    // Keep the first failure primary even if terminating its owned process also fails.
    console.error(
      'IOS_FIXTURE_COMMAND_FAILED ' +
        JSON.stringify({
          action,
          token,
          launchOutput,
          preparationElapsedMs: launched - started,
          receiptElapsedMs: Date.now() - launched,
          error: String(error),
        }),
    );
  } finally {
    try {
      command('terminate', owner.udid, bundle);
    } catch (cleanupError) {
      if (failure) console.error('IOS_FIXTURE_TERMINATE_FAILED ' + String(cleanupError));
      else failure = cleanupError;
    }
  }
  if (failure) throw failure;
  return result;
}
