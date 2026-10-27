import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { ownedFixtureCommand } from './ios-test-scoped-reset.mjs';

export const reminderDiagnosticTest =
  'OrotUITests/AppointmentReminderJourneyUITests/testLocalReplacementCancellationAndActualRunningAndColdNotificationTaps';

const bundleIdentifier = 'com.orot.mobile';
const fileName = 'appointment-reminder-diagnostic.jsonl';
const maximumBytes = 64 * 1024;
const requiredFields = ['callSequence', 'monotonicNanoseconds', 'processID', 'runID', 'stage'];
const allowedFields = new Set([
  ...requiredFields,
  'authorization',
  'operationSequence',
  'errorCode',
  'errorDomain',
  'nullPlan',
  'ownErrorCase',
]);
const stages = new Set([
  'diagnostic-ready',
  'bridge-enter',
  'bridge-resolve',
  'bridge-reject',
  'selection-write-enter',
  'selection-write-resolve',
  'selection-write-reject',
  'request-authorization-enter',
  'request-authorization-resolve',
  'request-authorization-reject',
  'permission-request-enter',
  'permission-request-resolve',
  'permission-request-reject',
  'authorization-observed',
  'plan-validation-enter',
  'plan-validation-resolve',
  'plan-validation-reject',
  'expiry-check',
  'expiry-reject',
  'authorization-check',
  'authorization-reject',
  'trigger-check',
  'trigger-resolve',
  'trigger-reject',
  'center-add-enter',
  'center-add-resolve',
  'center-add-reject',
  'cancel',
]);
const authorizationStates = new Set(['authorized', 'notDetermined', 'denied', 'unknown']);
const ownErrorCases = new Set(['invalidInput', 'permissionDenied', 'expired', 'other']);
const errorDomains = new Set([
  'UNErrorDomain',
  'NSCocoaErrorDomain',
  'NSPOSIXErrorDomain',
  'NSURLErrorDomain',
  'other',
]);

/** Opt-in diagnostic runs are restricted to the one parent-authorized native journey. */
export function verifyReminderDiagnosticSelection(profile, identifiers, enabled) {
  if (!enabled) return false;
  if (
    profile !== 'fixtures' ||
    identifiers.length !== 1 ||
    identifiers[0] !== reminderDiagnosticTest
  )
    throw new Error('Reminder diagnostics require the exact single fixture journey');
  return true;
}

export function prepareRun(profile, identifiers, flag) {
  if (flag === undefined) return null;
  if (flag !== 'YES') throw new Error('Invalid reminder diagnostic opt-in');
  verifyReminderDiagnosticSelection(profile, identifiers, true);
  return randomUUID();
}

/** Persist identity before XCTest launch; exclusive creation prevents replacing a lost run UUID. */
export function persistManifest(directory, runID, sourceSHA, identifiers) {
  if (!runID || !/^[a-f0-9]{40}$/i.test(sourceSHA))
    throw new Error('Diagnostic manifest requires its original run and source');
  writeFileSync(
    join(directory, 'reminder-diagnostic-manifest.json'),
    JSON.stringify(
      {
        expectedFlag: 'YES',
        runID,
        sourceSHA,
        diagnosticSHA: sourceSHA,
        selector: identifiers[0],
        externalBudgetMilliseconds: 1200000,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
}

/** Map the validated host run to the test process; the UI test sets the app launch environment. */
export function environment(runID) {
  return runID
    ? {
        TEST_RUNNER_OROT_IOS_REMINDER_DIAGNOSTICS: 'YES',
        TEST_RUNNER_OROT_IOS_REMINDER_DIAGNOSTIC_RUN_ID: runID,
      }
    : {};
}

/** Validate the complete bounded trace before it leaves the owned app container. */
export function validateReminderDiagnosticTrace(input, expectedRunID) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(expectedRunID) ||
    bytes.length === 0 ||
    bytes.length > maximumBytes
  )
    throw new Error('Reminder diagnostic run identity or trace size is invalid');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes) || !text.endsWith('\n'))
    throw new Error('Reminder diagnostic trace is not complete UTF-8 JSONL');
  const previous = new Map();
  const lines = text.slice(0, -1).split('\n');
  if (lines.some((line) => !line))
    throw new Error('Reminder diagnostic trace contains an empty record');
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error('Reminder diagnostic trace contains invalid JSON');
    }
    const keys = Object.keys(event).sort();
    const canonical = JSON.stringify(Object.fromEntries(keys.map((key) => [key, event[key]])));
    if (
      canonical !== line ||
      keys.some((key) => !allowedFields.has(key)) ||
      requiredFields.some((key) => !Object.hasOwn(event, key)) ||
      event.runID !== expectedRunID.toLowerCase() ||
      !Number.isSafeInteger(event.processID) ||
      event.processID <= 0 ||
      !Number.isSafeInteger(event.callSequence) ||
      event.callSequence < 1 ||
      typeof event.monotonicNanoseconds !== 'string' ||
      !/^\d+$/.test(event.monotonicNanoseconds) ||
      !stages.has(event.stage)
    )
      throw new Error('Reminder diagnostic trace violates its fixed event schema');
    if (
      Object.hasOwn(event, 'operationSequence') &&
      (!Number.isSafeInteger(event.operationSequence) || event.operationSequence < 1)
    )
      throw new Error('Reminder diagnostic invocation identity is invalid');
    if (Object.hasOwn(event, 'nullPlan') && typeof event.nullPlan !== 'boolean')
      throw new Error('Reminder diagnostic trace has an invalid null-plan value');
    if (Object.hasOwn(event, 'authorization') && !authorizationStates.has(event.authorization))
      throw new Error('Reminder diagnostic trace has an invalid authorization value');
    const hasError = ['ownErrorCase', 'errorDomain', 'errorCode'].some((key) =>
      Object.hasOwn(event, key),
    );
    if (
      hasError !== event.stage.endsWith('-reject') ||
      (hasError &&
        (!ownErrorCases.has(event.ownErrorCase) ||
          !errorDomains.has(event.errorDomain) ||
          !Number.isSafeInteger(event.errorCode)))
    )
      throw new Error('Reminder diagnostic trace has an invalid allowlisted error');
    const prior = previous.get(event.processID);
    const time = BigInt(event.monotonicNanoseconds);
    if (event.callSequence !== (prior?.sequence ?? 0) + 1 || (prior && time <= prior.time))
      throw new Error('Reminder diagnostic trace sequence is discontinuous');
    previous.set(event.processID, { sequence: event.callSequence, time });
  }
  return { bytes: bytes.length, events: lines.length };
}

/** Copy validated bytes once; exclusive creation preserves any unexpected prior artifact. */
export function copyValidatedReminderDiagnosticTrace(sourcePath, targetPath, runID) {
  if (existsSync(targetPath))
    throw new Error('Reminder diagnostic capture destination already exists');
  const bytes = readFileSync(sourcePath);
  const receipt = validateReminderDiagnosticTrace(bytes, runID);
  writeFileSync(targetPath, bytes, { flag: 'wx' });
  return receipt;
}

/** Resolve only the recorded fixture app container and preserve its validated trace before uninstall. */
function captureReminderDiagnosticTrace({ profile, owner, outputDirectory, runID }) {
  try {
    if (profile !== 'fixtures' || !owner?.udid)
      throw new Error('Reminder diagnostic owner is invalid');
    const container = ownedFixtureCommand(profile, owner, [
      'get_app_container',
      owner.udid,
      bundleIdentifier,
      'data',
    ]);
    if (!isAbsolute(container))
      throw new Error('Reminder diagnostic app container path is invalid');
    const source = join(container, 'Library', 'Caches', fileName);
    const target = resolve(outputDirectory, fileName);
    return { path: target, ...copyValidatedReminderDiagnosticTrace(source, target, runID) };
  } catch (error) {
    return { error: String(error) };
  }
}

/** Record bounded capture errors before the caller proceeds with owned fixture cleanup. */
export function captureBeforeCleanup(runID, owner, outputDirectory, identifier, failures) {
  if (!runID) return;
  const receipt = captureReminderDiagnosticTrace({
    profile: 'fixtures',
    owner,
    outputDirectory,
    runID,
  });
  if (receipt?.error)
    failures.push({ identifier, stage: 'diagnostic-capture', error: receipt.error });
}
