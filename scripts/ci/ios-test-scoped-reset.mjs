import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { runIosSimulatorCommand, verifyIosTestSimulator } from './ios-test-simulator.mjs';

const bundle = 'com.orot.mobile';
const pathNames = ['database', 'wal', 'shm', 'recordings', 'deletions', 'exports'];
const serviceNames = [
  'com.orot.mobile.database-encryption-key.v1',
  'com.orot.mobile.database-initialization.v1',
  'com.orot.mobile.provider-selection.v1',
  'com.orot.provider.openai.credentials',
  'com.orot.provider.openai.simulator-fixture',
];

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

function exactBooleans(value, names, expected) {
  return (
    value &&
    Object.keys(value).length === names.length &&
    names.every((name) => value[name] === expected)
  );
}

/** Observed absence is mandatory; a successful launch or omitted field cannot stand in for state reset. */
export function verifyIosFixtureReceipt(receipt, action, token) {
  if (
    receipt?.token !== token ||
    receipt?.action !== action ||
    receipt?.ok !== true ||
    !Number.isSafeInteger(receipt.processIdentifier) ||
    receipt.processIdentifier <= 0
  )
    throw new Error('Missing, stale or failed scoped fixture receipt');
  const state = receipt.state;
  if (
    action === 'reset' &&
    (!exactBooleans(state?.paths, pathNames, false) ||
      !exactBooleans(state?.keys, serviceNames, false) ||
      state.keyFingerprint !== null ||
      state.preferencesEmpty !== true ||
      state.pollutedPreferencesAbsent !== true ||
      state.microphoneUndetermined !== true ||
      state.speechUndetermined !== true)
  )
    throw new Error('Scoped reset left database, files, keys, preferences or permissions');
  if (
    action === 'seed' &&
    (!exactBooleans(state?.paths, pathNames, true) ||
      !exactBooleans(state?.keys, serviceNames, true) ||
      !/^[a-f0-9]{64}$/.test(state.keyFingerprint ?? '') ||
      state.preferencesEmpty !== false ||
      state.pollutedPreferencesAbsent !== false ||
      state.microphoneGranted !== true ||
      state.foreignFile !== true ||
      state.foreignKey !== true)
  )
    throw new Error('Scoped reset regression did not inject every required contamination category');
  return receipt;
}

/** Each public mutation rechecks exact simulator ownership. No other bundle or system Keychain is reset. */
export function ownedFixtureCommand(profile, owner, args) {
  if (
    !['fixtures', 'core'].includes(profile) ||
    verifyIosTestSimulator(owner, profile).state !== 'Booted'
  )
    throw new Error(
      'Scoped fixture commands require an owned booted fixture or isolation destination',
    );
  return runIosSimulatorCommand(args, { timeout: 30000 }).trim();
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
    ownedFixtureCommand(profile, owner, ['install', owner.udid, application]);
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
  try {
    // Public container/privacy/launch commands have their own deadlines. Their cost cannot consume the app's unchanged ten-second receipt window.
    while (!existsSync(receiptPath) && Date.now() - launched < 10000) await setTimeout(50);
    if (!existsSync(receiptPath)) throw new Error('Scoped fixture receipt deadline exceeded');
    const receipt = verifyIosFixtureReceipt(
      JSON.parse(readFileSync(receiptPath, 'utf8')),
      action,
      token,
    );
    unlinkSync(receiptPath);
    return {
      ...receipt,
      preparationElapsedMs: launched - started,
      receiptElapsedMs: Date.now() - launched,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    // Preserve the failed first launch and both measured phases before terminating its owned process.
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
    throw error;
  } finally {
    command('terminate', owner.udid, bundle);
  }
}
