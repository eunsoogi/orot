import { iosTestCohort, iosTestCohortTasks } from './ios-test-cohorts.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';
import { iosTestBuildSpec } from './ios-test-config.mjs';

const names = [
  ['core-integration', 'Core'],
  ['core-ui', 'UI'],
  ['health-review-ui', 'Health review / UI'],
  ['recording-evidence', 'Recording evidence'],
  ['persistence', 'Persistence'],
  ['encounter-review-persistence', 'Recordings / Encounter review persistence'],
  ['isolation', 'Isolation'],
  ['backup', 'Backup'],
  ['local-model', 'Local model'],
  ['navigation-features', 'Navigation / Features'],
  ['navigation-routes', 'Navigation / Routes'],
  ['navigation-accessibility', 'Navigation / Accessibility'],
  ['navigation-imports', 'Navigation / Imports'],
  ['recordings-controls', 'Recordings / Controls'],
  ['recordings-review', 'Recordings / Review'],
  ['recordings-playback', 'Recordings / Playback'],
  ['questions-review', 'Questions / Review'],
  ['questions-conversation', 'Questions / Conversation'],
  ['questions-accessibility', 'Questions / Accessibility'],
  ['questions-summary', 'Questions / Summary'],
  ['questions-literature', 'Questions / Literature'],
  ['calendar-consent', 'Calendar / Consent'],
  ['calendar-appointments', 'Calendar / Appointments'],
  ['provider', 'Provider'],
  ['health-observations', 'Health observations'],
  ['health-recovery', 'Health recovery'],
  ['microphone', 'Microphone'],
  ['selection', 'Selection'],
  ['speech', 'Speech'],
];

export const IOS_TEST_COHORT_NAMES = Object.freeze(names.map(([cohort]) => cohort));

/** Validate the maintained full inventory before returning a requested subset of complete cohort tasks. */
export function iosTestExecutionPlan(selectedCohorts = IOS_TEST_COHORT_NAMES) {
  const plan = names.map(([cohort, name]) => {
    const definition = iosTestCohort(cohort);
    return {
      cohort,
      name,
      profile: definition.profiles[0],
      configuration: definition.config.configuration,
      minutes: definition.minutes,
    };
  });
  const profiles = new Set(
    ['core', 'provider-data'].flatMap((profile) => iosTestBuildSpec(profile).compatibleExecutions),
  );
  const expected = new Set([
    ...[...profiles].flatMap((profile) => iosTestInventory(profile)),
    ...iosTestInventory('speech', 'preparation'),
  ]);
  const actual = plan.flatMap((entry) =>
    iosTestCohortTasks(entry.cohort).flatMap((task) => task.identifiers),
  );
  if (
    actual.length !== new Set(actual).size ||
    actual.length !== expected.size ||
    actual.some((id) => !expected.has(id))
  )
    throw new Error('Hosted iOS plan omits or repeats maintained observations');
  if (
    !Array.isArray(selectedCohorts) ||
    selectedCohorts.length === 0 ||
    new Set(selectedCohorts).size !== selectedCohorts.length ||
    selectedCohorts.some((cohort) => !IOS_TEST_COHORT_NAMES.includes(cohort))
  )
    throw new Error('Hosted iOS selection must contain unique known cohorts');
  const selected = new Set(selectedCohorts);
  return plan.filter((entry) => selected.has(entry.cohort));
}
