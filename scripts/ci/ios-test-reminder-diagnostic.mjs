import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { copyValidatedReminderDiagnosticTrace } from './ios-test-reminder-trace.mjs';
import { ownedFixtureCommand } from './ios-test-scoped-reset.mjs';

export const reminderDiagnosticTest =
  'OrotUITests/AppointmentReminderJourneyUITests/testLocalReplacementCancellationAndActualRunningAndColdNotificationTaps';

const bundleIdentifier = 'com.orot.mobile';
const fileName = 'appointment-reminder-diagnostic.jsonl';
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

/** Direct runner entry retains exact selection and UUID admission before xcodebuild starts. */
export function environmentForRunner(profile, identifiers, invocationId, input = process.env) {
  const flag = input.TEST_RUNNER_OROT_IOS_REMINDER_DIAGNOSTICS;
  const runID = input.TEST_RUNNER_OROT_IOS_REMINDER_DIAGNOSTIC_RUN_ID;
  if (
    flag !== undefined ||
    runID !== undefined ||
    input.OROT_IOS_REMINDER_DIAGNOSTICS !== undefined
  ) {
    verifyReminderDiagnosticSelection(profile, identifiers, true);
    if (
      flag !== 'YES' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(runID ?? '')
    )
      throw new Error('Reminder runner requires its admitted diagnostic run');
  }
  return { ...input, TEST_RUNNER_OROT_IOS_TEST_INVOCATION: invocationId };
}

/** Resolve only the recorded fixture app container and preserve its validated trace before uninstall. */
function captureReminderDiagnosticTrace({ profile, owner, outputDirectory, runID }) {
  try {
    if (profile !== 'fixtures' || !owner?.udid)
      throw new Error('Reminder diagnostic owner is invalid');
    // Stop this exact owned app before reading its writer. A missing process is already terminal.
    try {
      ownedFixtureCommand(profile, owner, ['terminate', owner.udid, bundleIdentifier]);
    } catch (error) {
      if (error.status !== 3 || !String(error.stderr).includes('domain=NSPOSIXErrorDomain, code=3'))
        throw new Error('Diagnostic app writer termination was not confirmed');
    }
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
  if (receipt?.error) {
    failures.push({ identifier, stage: 'diagnostic-capture', error: receipt.error });
    throw new Error('Diagnostic trace capture failed; preserve the owned container');
  }
}
