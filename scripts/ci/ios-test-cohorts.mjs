import { isDeepStrictEqual } from 'node:util';
import { iosTestConfig } from './ios-test-config.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';

const cohorts = {
  release: { profiles: ['core', 'fixtures', 'backup', 'local-model'], minutes: 200 },
  speech: { profiles: ['speech'], minutes: 90 },
  debug: {
    profiles: ['provider-data', 'health-import', 'microphone', 'provider-selection'],
    minutes: 180,
  },
};

export const IOS_SPEECH_SAMPLES = Object.freeze(['first', 'second', 'third']);

/** Fresh Speech samples are distinct first executions. Other cohorts have only their original first execution. */
export function iosTestCohortSample(cohort, sample = 'first') {
  if (
    !Object.hasOwn(cohorts, cohort) ||
    !IOS_SPEECH_SAMPLES.includes(sample) ||
    (cohort !== 'speech' && sample !== 'first')
  )
    throw new Error('Invalid integration cohort sample identity');
  return sample;
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
  // These are sums of the previous profile-job allowances, not extensions of a recognition, model, UI or cancellation deadline.
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
          { profile: 'speech', suite: 'ui', mode: 'plain' },
        ]
      : definition.profiles.flatMap((profile) =>
          profile === 'core'
            ? ['integration', 'ui'].map((suite) => ({ profile, suite, mode: 'plain' }))
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
  return tasks.map((task) => ({
    ...task,
    identifiers: iosTestInventory(task.profile, task.suite),
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
