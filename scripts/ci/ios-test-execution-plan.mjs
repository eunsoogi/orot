import { iosTestCohort, iosTestCohortTasks } from './ios-test-cohorts.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';
import { iosTestBuildSpec } from './ios-test-config.mjs';

const names = [
  ['core-integration', 'Core'],
  ['core-ui', 'UI'],
  ['persistence', 'Persistence'],
  ['isolation', 'Isolation'],
  ['backup', 'Backup'],
  ['local-model', 'Local model'],
  ['navigation', 'Navigation'],
  ['recordings', 'Recordings'],
  ['questions', 'Questions'],
  ['calendar', 'Calendar'],
  ['provider', 'Provider'],
  ['health', 'Health'],
  ['microphone', 'Microphone'],
  ['selection', 'Selection'],
  ['speech', 'Speech'],
];

/** This is the full hosted feature plan. Shared products never imply a dependency between independent executors. */
export function iosTestExecutionPlan() {
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
  return plan;
}
