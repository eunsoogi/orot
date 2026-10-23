import { iosTestConfig, speechJourneyTests } from './ios-test-config.mjs';
import { iosTestCohortTasks, iosTestTaskNeedsUiPreparation } from './ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from './ios-test-execution-plan.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';
import { fixtureIsolationTests } from './fixture-isolation-test-phases.mjs';
import { recordingPersistenceTests } from './recording-persistence-test-phases.mjs';
import { statePersistenceTests } from './state-persistence-test-phases.mjs';

/** Focus is an exact diagnostic selection. Stateful phases and named fixture groups must be requested explicitly. */
export function selectFocusedIosTests(profileInput, scenarioFile, scenarioName) {
  if (![profileInput, scenarioFile, scenarioName].every((value) => typeof value === 'string'))
    throw new Error('iOS focus requires string profile, source file and exact test selection');
  const profile = /^ios\/([a-z][a-z-]+)$/.exec(profileInput)?.[1];
  if (!profile) throw new Error('iOS focus profile must use ios/<profile>');
  const configuration = iosTestConfig(profile).configuration;
  const inventory = iosTestInventory(profile);
  if (profile === 'core' && scenarioName === 'group/state-persistence') {
    if (scenarioFile !== 'scripts/ci/state-persistence-test-phases.mjs')
      throw new Error('State persistence focus requires its exact phase driver');
    return {
      profile,
      configuration,
      mode: 'state-persistence',
      suite: 'state-persistence',
      fixtureSuite: 'all',
      identifiers: statePersistenceTests.slice(),
      identifier: '',
      prepareUi: iosTestTaskNeedsUiPreparation({
        mode: 'state-persistence',
        suite: 'state-persistence',
        identifiers: statePersistenceTests,
      }),
      expectedCount: statePersistenceTests.length,
    };
  }
  if (statePersistenceTests.includes(scenarioName))
    throw new Error('State persistence focus requires the complete group/state-persistence phases');
  if (profile === 'core' && scenarioName === 'group/recording-persistence') {
    if (scenarioFile !== 'scripts/ci/recording-persistence-test-phases.mjs')
      throw new Error('Recording persistence focus requires its exact phase driver');
    return {
      profile,
      configuration,
      mode: 'recording-persistence',
      suite: 'recording-persistence',
      fixtureSuite: 'all',
      identifiers: recordingPersistenceTests.slice(),
      identifier: '',
      prepareUi: iosTestTaskNeedsUiPreparation({
        mode: 'recording-persistence',
        suite: 'recording-persistence',
        identifiers: recordingPersistenceTests,
      }),
      expectedCount: recordingPersistenceTests.length,
    };
  }
  if (recordingPersistenceTests.includes(scenarioName))
    throw new Error(
      'Recording persistence focus requires the complete group/recording-persistence phases',
    );
  if (profile === 'core' && scenarioName === 'group/isolation') {
    if (scenarioFile !== 'scripts/ci/fixture-isolation-test-phases.mjs')
      throw new Error('Fixture isolation focus requires its exact phase driver');
    return {
      profile,
      configuration,
      mode: 'fixture-isolation',
      suite: 'isolation',
      fixtureSuite: 'all',
      identifiers: fixtureIsolationTests.slice(),
      identifier: '',
      prepareUi: iosTestTaskNeedsUiPreparation({
        mode: 'fixture-isolation',
        suite: 'isolation',
        identifiers: fixtureIsolationTests,
      }),
      expectedCount: fixtureIsolationTests.length,
    };
  }
  if (fixtureIsolationTests.includes(scenarioName))
    throw new Error('Fixture isolation focus requires the complete group/isolation phases');
  if (profile === 'speech' && scenarioName === 'group/journey') {
    if (scenarioFile !== 'scripts/ci/speech-journey-test-phases.mjs')
      throw new Error('Speech journey focus requires its exact phase driver');
    return {
      profile,
      configuration,
      mode: 'speech-journey',
      suite: 'journey',
      fixtureSuite: 'all',
      identifiers: speechJourneyTests.slice(),
      identifier: '',
      prepareUi: iosTestTaskNeedsUiPreparation({
        mode: 'speech-journey',
        suite: 'journey',
        identifiers: speechJourneyTests,
      }),
      expectedCount: speechJourneyTests.length,
    };
  }
  if (speechJourneyTests.includes(scenarioName))
    throw new Error('Speech UI and persistence focus requires the complete group/journey phases');
  const authenticationTests = iosTestInventory('core', 'authentication');
  if (profile === 'core' && scenarioName === 'group/authentication') {
    if (
      scenarioFile !==
      'apps/mobile/ios/OrotIntegrationTests/KeychainAuthenticationIntegrationTests.m'
    )
      throw new Error('Authentication focus requires its exact Objective-C test source');
    // Keep no-UI and prompted protected queries together on one enrolled owner Simulator.
    return {
      profile,
      configuration,
      mode: 'authentication',
      suite: 'integration',
      fixtureSuite: 'authentication',
      identifiers: authenticationTests,
      identifier: '',
      prepareUi: iosTestTaskNeedsUiPreparation({
        mode: 'authentication',
        suite: 'integration',
        identifiers: authenticationTests,
      }),
      expectedCount: authenticationTests.length,
    };
  }
  if (authenticationTests.includes(scenarioName))
    throw new Error('Authentication focus requires the complete group/authentication suite');
  const statefulGroup = ['backup', 'local-model'].includes(profile);
  const fixtureGroup =
    profile === 'fixtures' && (scenarioName === 'all' || scenarioName.startsWith('group/'));
  const fixtureSuite = fixtureGroup ? scenarioName.replace(/^group\//, '') : 'all';
  const grouped = statefulGroup || fixtureGroup;
  const identifiers = fixtureGroup
    ? iosTestInventory(profile, fixtureSuite)
    : statefulGroup && scenarioName === 'all'
      ? inventory
      : [scenarioName];
  if (statefulGroup && scenarioName !== 'all')
    throw new Error('Stateful backup and local-model focus requires the complete all phase group');
  if (identifiers.some((identifier) => !inventory.includes(identifier)))
    throw new Error('iOS focus must name an exact registered test in its profile');
  const files = identifiers.map((identifier) => {
    const [target, name] = identifier.split('/');
    return `apps/mobile/ios/${target}/${name}.swift`;
  });
  if (
    fixtureGroup
      ? scenarioFile !== 'scripts/ci/ios-test-fixture-groups.mjs'
      : !files.every((file) => file === scenarioFile)
  )
    throw new Error('iOS focus source file does not match the selected test or phase group');
  const mode = statefulGroup
    ? profile
    : ['fixtures', 'microphone', 'health-import', 'provider-selection'].includes(profile)
      ? 'fixture'
      : 'plain';
  const suite = identifiers[0].startsWith('OrotUITests/') ? 'ui' : 'integration';
  return {
    profile,
    configuration,
    mode,
    suite,
    fixtureSuite,
    identifiers,
    identifier: grouped ? '' : identifiers[0],
    prepareUi: iosTestTaskNeedsUiPreparation({ mode, suite, identifiers }),
    expectedCount: identifiers.length,
  };
}

/** A PR selector must bind the workflow's actual branch/SHA, never silently substitute a different checkout. */
export function verifyFocusedIosPullRequest(context, number, pullRequest) {
  if (
    typeof number !== 'string' ||
    !/^[1-9]\d*$/.test(number) ||
    !Number.isSafeInteger(Number(number))
  )
    throw new Error('iOS focus PR number must be a positive integer');
  if (
    pullRequest?.number !== Number(number) ||
    pullRequest.state !== 'open' ||
    pullRequest.head?.repo?.full_name !== context.repository ||
    pullRequest.head?.sha !== context.sha ||
    pullRequest.head?.ref !== context.ref
  )
    throw new Error(
      'iOS focus must run the selected open PR head in its own repository and branch',
    );
}

/** Complete fixture selections share the full plan's independent jobs, never an oversized aggregate VM. */
export function focusedIosTestCohorts(selection) {
  if (selection.profile !== 'fixtures' || selection.mode !== 'fixture' || selection.identifier)
    return [];
  const cohorts = iosTestExecutionPlan().filter(
    (job) =>
      job.profile === 'fixtures' &&
      iosTestCohortTasks(job.cohort).every(
        (task) => selection.fixtureSuite === 'all' || task.suite === selection.fixtureSuite,
      ),
  );
  const identifiers = cohorts.flatMap((job) =>
    iosTestCohortTasks(job.cohort).flatMap((task) => task.identifiers),
  );
  if (
    JSON.stringify(identifiers.slice().sort()) !==
    JSON.stringify(selection.identifiers.slice().sort())
  )
    throw new Error('Focused cohort partition differs from the exact requested observations');
  return cohorts.map((job) => job.cohort);
}

/** Exactly one execution route must pass; the alternate route must be explicitly skipped. */
export function verifyFocusedIosJobResults(results, cohorts) {
  if (
    !Array.isArray(cohorts) ||
    (cohorts.length && iosTestExecutionPlan(cohorts).some((job) => job.profile !== 'fixtures'))
  )
    throw new Error('Invalid focused fixture cohort selection');
  const expected = {
    selection: 'success',
    products: 'success',
    execution: cohorts.length ? 'skipped' : 'success',
    fixture_execution: cohorts.length ? 'success' : 'skipped',
  };
  if (
    !results ||
    Object.keys(results).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([name, result]) => results[name]?.result !== result)
  )
    throw new Error('Incomplete integration focus');
}
