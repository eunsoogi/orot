import { appendFileSync } from 'node:fs';
import { iosTestCohort, iosTestCohortTasks, IOS_SPEECH_SAMPLES } from './ios-test-cohorts.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';

// This Linux-only planning stage validates coverage and configuration before consuming any macOS slot.
if (!process.env.GITHUB_OUTPUT) throw new Error('Native planning requires workflow outputs');
const names = ['release', 'speech', 'debug'];
const definitions = names.map(iosTestCohort);
const actual = new Set(
  names.flatMap((name) => iosTestCohortTasks(name).flatMap((task) => task.identifiers)),
);
const profiles = definitions.flatMap((value) => value.profiles);
const primaryObservations = names.flatMap((name) =>
  iosTestCohortTasks(name).flatMap((task) => task.identifiers),
);
const speechObservations = iosTestCohortTasks('speech').flatMap((task) => task.identifiers);
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
    // Two producers and one execution per cohort are primary jobs; only later Speech samples add fresh execution jobs.
    macJobs: 2 + names.length + IOS_SPEECH_SAMPLES.length - 1,
    maximumConcurrentMacJobs: 3,
    uniqueNativeCases: actual.size,
    scheduledNativeObservations:
      primaryObservations.length + (IOS_SPEECH_SAMPLES.length - 1) * speechObservations.length,
    speechSamples: IOS_SPEECH_SAMPLES,
    builds: ['Release', 'Debug'],
    cohorts: definitions.map((value) => ({ name: value.name, profiles: value.profiles })),
  }),
);
