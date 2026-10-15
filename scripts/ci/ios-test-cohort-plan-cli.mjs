import { appendFileSync } from 'node:fs';
import { iosTestCohort, iosTestCohortTasks } from './ios-test-cohorts.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';

// This Linux-only planning stage validates coverage and configuration before consuming any macOS slot.
if (!process.env.GITHUB_OUTPUT) throw new Error('iOS planning requires workflow outputs');
const names = ['release-core', 'release-ui', 'speech', 'debug'];
const definitions = names.map(iosTestCohort);
const actual = new Set(
  names.flatMap((name) => iosTestCohortTasks(name).flatMap((task) => task.identifiers)),
);
const profiles = definitions.flatMap((value) => value.profiles);
const primaryObservations = names.flatMap((name) =>
  iosTestCohortTasks(name).flatMap((task) => task.identifiers),
);
const expected = new Set([
  ...profiles.flatMap((profile) => iosTestInventory(profile)),
  ...iosTestInventory('speech', 'preparation'),
]);
// Equivalent requirements may move between boundaries, but every registered observation must occur exactly once.
if (primaryObservations.length !== actual.size)
  throw new Error('iOS cohort plan repeats a maintained observation');
const releaseExpected = iosTestCohortTasks('release')
  .flatMap((task) => task.identifiers)
  .sort();
const releaseActual = names
  .filter((name) => name.startsWith('release-'))
  .flatMap((name) => iosTestCohortTasks(name).flatMap((task) => task.identifiers))
  .sort();
if (JSON.stringify(releaseActual) !== JSON.stringify(releaseExpected))
  throw new Error('Release execution partitions omit or repeat maintained observations');
if (actual.size !== expected.size || [...expected].some((identifier) => !actual.has(identifier)))
  throw new Error('iOS cohort plan omits maintained requirements');
appendFileSync(
  process.env.GITHUB_OUTPUT,
  definitions
    .map((value) => `${value.name.replaceAll('-', '_')}_minutes=${value.minutes}`)
    .join('\n') + '\n',
);
console.log(
  JSON.stringify({
    // Acceptance is one complete candidate execution. The separate Release producer never boots a test destination.
    macJobs: definitions.length + 1,
    maximumConcurrentMacJobs: 4,
    uniqueTestCases: actual.size,
    scheduledTestObservations: primaryObservations.length,
    builds: ['Release', 'Debug'],
    cohorts: definitions.map((value) => ({ name: value.name, profiles: value.profiles })),
  }),
);
