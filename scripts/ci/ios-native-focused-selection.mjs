import { iosTestConfig } from './ios-test-config.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';

/** Focus is an exact diagnostic selection. Stateful phases and named fixture groups must be requested explicitly. */
export function selectFocusedNativeTests(profileInput, scenarioFile, scenarioName) {
  if (![profileInput, scenarioFile, scenarioName].every((value) => typeof value === 'string'))
    throw new Error('Native focus requires string profile, source file and exact test selection');
  const profile = /^native\/([a-z][a-z-]+)$/.exec(profileInput)?.[1];
  if (!profile) throw new Error('Native focus profile must use native/<profile>');
  const configuration = iosTestConfig(profile).configuration;
  const inventory = iosTestInventory(profile);
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
    throw new Error('Native focus must name an exact registered test in its profile');
  const files = identifiers.map((identifier) => {
    const [target, name] = identifier.split('/');
    return `apps/mobile/ios/${target}/${name}.swift`;
  });
  if (
    fixtureGroup
      ? scenarioFile !== 'scripts/ci/ios-test-fixture-groups.mjs'
      : !files.every((file) => file === scenarioFile)
  )
    throw new Error('Native focus source file does not match the selected test or phase group');
  const mode = statefulGroup
    ? profile
    : ['fixtures', 'microphone', 'health-import', 'provider-selection'].includes(profile)
      ? 'fixture'
      : 'plain';
  const suite = identifiers[0].startsWith('OrotUITests/') ? 'ui' : 'native';
  return {
    profile,
    configuration,
    mode,
    suite,
    fixtureSuite,
    identifiers,
    identifier: grouped ? '' : identifiers[0],
    prepareUi: mode === 'fixture' || mode === 'backup' || suite === 'ui',
    expectedCount: identifiers.length,
  };
}

/** A PR selector must bind the workflow's actual branch/SHA, never silently substitute a different checkout. */
export function verifyFocusedNativePullRequest(context, number, pullRequest) {
  if (
    typeof number !== 'string' ||
    !/^[1-9]\d*$/.test(number) ||
    !Number.isSafeInteger(Number(number))
  )
    throw new Error('Native focus PR number must be a positive integer');
  if (
    pullRequest?.number !== Number(number) ||
    pullRequest.state !== 'open' ||
    pullRequest.head?.repo?.full_name !== context.repository ||
    pullRequest.head?.sha !== context.sha ||
    pullRequest.head?.ref !== context.ref
  )
    throw new Error(
      'Native focus must run the selected open PR head in its own repository and branch',
    );
}
