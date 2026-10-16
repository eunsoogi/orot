import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
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
  ];
  return profile === 'fixtures' && scopedClasses.includes(identifier.split('/')[1])
    ? 'scoped'
    : 'fresh-install';
}

/** Each command rechecks exact ownership and awaits its real exit; hosted job cancellation is the outer limit. */
export function ownedFixtureCommand(profile, owner, args) {
  if (
    !['fixtures', 'core'].includes(profile) ||
    verifyIosTestSimulator(owner, profile).state !== 'Booted'
  )
    throw new Error(
      'Scoped fixture commands require an owned booted fixture or isolation destination',
    );
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
    // Command completion precedes this separate ten-second app-receipt window; preparation cannot consume it.
    while (!existsSync(receiptPath) && Date.now() - launched < 10000) await setTimeout(50);
    if (!existsSync(receiptPath)) throw new Error('Scoped fixture receipt deadline exceeded');
    const receipt = verifyIosFixtureReceipt(
      JSON.parse(readFileSync(receiptPath, 'utf8')),
      action,
      token,
    );
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
