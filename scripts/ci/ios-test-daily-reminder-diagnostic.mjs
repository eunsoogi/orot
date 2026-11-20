const selector =
  'OrotUITests/DailyReminderDeliveryUITests/testScheduledDailyReminderOpensPreparationFromSystemBanner';
const flagKey = 'TEST_RUNNER_OROT_DAILY_REMINDER_DIAGNOSTICS';
const runKey = 'TEST_RUNNER_OROT_DAILY_REMINDER_DIAGNOSTIC_RUN_ID';

/** Admit only the real daily core journey; this never enables fixture capture or changes scheduling. */
export function verifyDailyReminderRunnerEnvironment(profile, identifiers, input) {
  const keys = Object.keys(input).filter((key) =>
    /^(?:TEST_RUNNER_OROT|OROT_TEST|OROT)_DAILY_REMINDER_DIAGNOSTIC/u.test(key),
  );
  if (keys.length === 0) return;
  const runID = input[runKey];
  if (
    keys.some((key) => key !== flagKey && key !== runKey) ||
    input[flagKey] !== 'YES' ||
    typeof runID !== 'string' ||
    runID.length !== 36 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(runID) ||
    profile !== 'core' ||
    identifiers.length !== 1 ||
    identifiers[0] !== selector
  )
    throw new Error(
      'Daily reminder diagnostics require the exact core journey, explicit flag and run UUID',
    );
}
