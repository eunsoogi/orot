import { appendFileSync } from 'node:fs';
import { iosTestCohort, iosTestCohortTasks } from './ios-test-cohorts.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';

// This Linux-only planning stage validates coverage and configuration before consuming any macOS slot.
if (!process.env.GITHUB_OUTPUT) throw new Error('Native planning requires workflow outputs');
const names = ['release', 'speech', 'debug'];
const definitions = names.map(iosTestCohort);
const actual = new Set(
  names.flatMap((name) => iosTestCohortTasks(name).flatMap((task) => task.identifiers)),
);
const profiles = definitions.flatMap((value) => value.profiles);
const expected = new Set([
  ...profiles.flatMap((profile) => iosTestInventory(profile)),
  ...iosTestInventory('speech', 'preparation'),
]);
if (actual.size !== expected.size || [...expected].some((identifier) => !actual.has(identifier)))
  throw new Error('Native cohort plan omits maintained requirements');
appendFileSync(
  process.env.GITHUB_OUTPUT,
  definitions.map((value) => `${value.name}_minutes=${value.minutes}`).join('\n') + '\n',
);
console.log(
  JSON.stringify({
    macJobs: 5,
    maximumConcurrentMacJobs: 3,
    uniqueNativeCases: actual.size,
    builds: ['Release', 'Debug'],
    cohorts: definitions.map((value) => ({ name: value.name, profiles: value.profiles })),
  }),
);
