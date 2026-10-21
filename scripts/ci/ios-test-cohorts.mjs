import { isDeepStrictEqual } from 'node:util';
import { iosTestConfig } from './ios-test-config.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';

const cohorts = {
  release: { profiles: ['core', 'fixtures', 'backup', 'local-model'], minutes: 200 },
  // Hosted Release consumers partition tasks, never individual cases or stateful restore/model phases.
  'release-core': {
    profiles: ['core', 'backup', 'local-model', 'fixtures'],
    fixtureSuites: ['questions'],
    minutes: 120,
  },
  'release-ui': {
    profiles: ['fixtures'],
    fixtureSuites: ['navigation', 'recordings', 'calendar'],
    minutes: 90,
  },
  speech: { profiles: ['speech'], minutes: 90 },
  debug: {
    profiles: ['provider-data', 'health-import', 'microphone', 'provider-selection'],
    minutes: 180,
  },
  // Hosted jobs separate independent feature suites. Only phases that exchange state stay in one task driver.
  'core-integration': { profiles: ['core'], suites: ['integration'], minutes: 45 },
  'core-ui': { profiles: ['core'], suites: ['ui'], minutes: 45 },
  persistence: { profiles: ['core'], suites: ['shared-persistence'], minutes: 45 },
  isolation: { profiles: ['core'], suites: ['isolation'], minutes: 30 },
  backup: { profiles: ['backup'], minutes: 65 },
  'local-model': { profiles: ['local-model'], minutes: 65 },
  navigation: { profiles: ['fixtures'], suites: ['navigation'], minutes: 60 },
  recordings: { profiles: ['fixtures'], suites: ['recordings'], minutes: 60 },
  questions: { profiles: ['fixtures'], suites: ['questions'], minutes: 45 },
  'questions-review': {
    profiles: ['fixtures'],
    suites: ['questions'],
    minutes: 30,
    classes: ['NextVisitReviewUITests', 'VisitQuestionConsentUITests'],
  },
  'questions-conversation': {
    profiles: ['fixtures'],
    suites: ['questions'],
    minutes: 30,
    classes: ['KeyboardSafeAreaUITests'],
  },
  'questions-summary': {
    profiles: ['fixtures'],
    suites: ['questions'],
    minutes: 30,
    classes: ['SummaryAndLiteratureUITests'],
  },
  calendar: { profiles: ['fixtures'], suites: ['calendar'], minutes: 60 },
  provider: { profiles: ['provider-data'], minutes: 45 },
  health: { profiles: ['health-import'], minutes: 45 },
  microphone: { profiles: ['microphone'], minutes: 45 },
  selection: { profiles: ['provider-selection'], minutes: 45 },
};

/** UI host preparation follows the selected XCTest task, independent of cohort naming. */
export function iosTestTaskNeedsUiPreparation(task) {
  if (!task || !Array.isArray(task.identifiers))
    throw new Error('iOS UI preparation requires a planned task inventory');
  return (
    ['fixture', 'backup', 'speech-journey'].includes(task.mode) ||
    task.suite === 'ui' ||
    task.identifiers.some((identifier) => identifier.split('/')[0] === 'OrotUITests')
  );
}

/** A cohort owns one destination only when configuration, compiler flags, runtime and device all agree. Speech retains its separate pinned runtime. */
export function iosTestCohort(name) {
  if (!Object.hasOwn(cohorts, name)) throw new Error('Unknown integration test cohort');
  const cohort = cohorts[name];
  const config = iosTestConfig(cohort.profiles[0]);
  const comparable = (value) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'profile'));
  for (const profile of cohort.profiles) {
    if (!isDeepStrictEqual(comparable(iosTestConfig(profile)), comparable(config)))
      throw new Error('iOS cohort contains incompatible configuration or destination');
  }
  // These are outer hosted job cancellation boundaries; individual test/setup observations have no elapsed-time allowance.
  return { name, profiles: cohort.profiles.slice(), config, minutes: cohort.minutes };
}

/** Logical groups remain separate result boundaries while sharing one verified product and one boot. No task is retried after a failure. */
export function iosTestCohortTasks(name) {
  const definition = iosTestCohort(name);
  const tasks =
    name === 'speech'
      ? [
          { profile: 'speech', suite: 'preparation', mode: 'plain' },
          { profile: 'speech', suite: 'integration', mode: 'plain' },
          { profile: 'speech', suite: 'journey', mode: 'speech-journey' },
        ]
      : definition.profiles.flatMap((profile) =>
          profile === 'core'
            ? [
                { profile, suite: 'shared-persistence', mode: 'shared-persistence' },
                { profile, suite: 'isolation', mode: 'fixture-isolation' },
                ...['integration', 'ui'].map((suite) => ({ profile, suite, mode: 'plain' })),
              ]
            : profile === 'fixtures'
              ? ['navigation', 'recordings', 'questions', 'calendar'].map((suite) => ({
                  profile,
                  suite,
                  mode: 'fixture',
                }))
              : [
                  {
                    profile,
                    suite: 'all',
                    mode: ['backup', 'local-model'].includes(profile)
                      ? profile
                      : ['health-import', 'microphone', 'provider-selection'].includes(profile)
                        ? 'fixture'
                        : 'plain',
                  },
                ],
        );
  return tasks
    .filter((task) => !cohorts[name].suites || cohorts[name].suites.includes(task.suite))
    .filter(
      (task) =>
        task.profile !== 'fixtures' ||
        !cohorts[name].fixtureSuites ||
        cohorts[name].fixtureSuites.includes(task.suite),
    )
    .map((task) => ({
      ...task,
      identifiers: iosTestInventory(task.profile, task.suite).filter(
        (identifier) =>
          !cohorts[name].classes || cohorts[name].classes.includes(identifier.split('/')[1]),
      ),
    }));
}

/** Cohort ownership is explicit; an ordinary profile owner cannot be relabelled to authorize another profile's mutations. */
export function verifyIosSimulatorOwnerContract(owner, profile) {
  const config = iosTestConfig(profile);
  if (owner.cohort !== undefined) {
    const cohort = iosTestCohort(owner.cohort);
    if (
      owner.profile !== undefined ||
      !cohort.profiles.includes(profile) ||
      !isDeepStrictEqual(owner.profiles, cohort.profiles) ||
      !owner.name?.startsWith(`OrotTests-cohort-${cohort.name}-`)
    )
      throw new Error('iOS simulator cohort ownership mismatch');
  } else if (owner.profile !== profile || owner.profiles !== undefined) {
    throw new Error('iOS simulator execution contract mismatch');
  }
  if (owner.runtime !== config.runtime || owner.device !== config.device)
    throw new Error('iOS simulator execution contract mismatch');
  return config;
}
