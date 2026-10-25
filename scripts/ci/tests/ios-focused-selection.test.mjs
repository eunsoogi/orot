import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { speechJourneyTests } from '../ios-test-config.mjs';
import { fixtureIsolationTests } from '../fixture-isolation-test-phases.mjs';
import { selectFocusedIosTests } from '../ios-focused-selection.mjs';

const profiles = [
  'core',
  'speech',
  'fixtures',
  'microphone',
  'health-import',
  'provider-selection',
  'provider-data',
  'backup',
  'local-model',
];
test('fixture reset focus retains both native processes and the intervening contamination proof', () => {
  const selection = selectFocusedIosTests(
    'ios/core',
    'scripts/ci/fixture-isolation-test-phases.mjs',
    'group/isolation',
  );
  assert.equal(selection.mode, 'fixture-isolation');
  assert.equal(selection.prepareUi, false);
  assert.deepEqual(selection.identifiers, fixtureIsolationTests);
  for (const id of fixtureIsolationTests)
    assert.throws(() =>
      selectFocusedIosTests(
        'ios/core',
        'apps/mobile/ios/OrotIntegrationTests/FixtureIsolationTests.swift',
        id,
      ),
    );
});

test('authentication focus preserves both protected Keychain assertions as one suite', () => {
  const file = 'apps/mobile/ios/OrotIntegrationTests/KeychainAuthenticationIntegrationTests.m';
  const authentication = iosTestInventory('core', 'authentication');
  const selection = selectFocusedIosTests('ios/core', file, 'group/authentication');

  assert.equal(selection.mode, 'authentication');
  assert.equal(selection.suite, 'integration');
  assert.equal(selection.fixtureSuite, 'authentication');
  assert.equal(selection.prepareUi, true);
  assert.equal(selection.identifier, '');
  assert.equal(selection.expectedCount, authentication.length);
  assert.deepEqual(selection.identifiers, authentication);
  for (const id of authentication) assert.throws(() => selectFocusedIosTests('ios/core', file, id));
});

test('Speech focus preserves the UI-created baseline and its complete new-process readback group', () => {
  const selection = selectFocusedIosTests(
    'ios/speech',
    'scripts/ci/speech-journey-test-phases.mjs',
    'group/journey',
  );
  assert.equal(selection.mode, 'speech-journey');
  assert.equal(selection.prepareUi, true);
  assert.deepEqual(selection.identifiers, speechJourneyTests);
  for (const id of speechJourneyTests) {
    const [target, name] = id.split('/');
    assert.throws(() =>
      selectFocusedIosTests('ios/speech', `apps/mobile/ios/${target}/${name}.swift`, id),
    );
  }
});
for (const profile of profiles) {
  test(`integration focus preserves exact ${profile} selection and its isolation mode`, () => {
    const inventory = iosTestInventory(profile, profile === 'core' ? 'integration' : 'all');
    const grouped = ['backup', 'local-model'].includes(profile);
    const id = grouped ? 'all' : inventory[0];
    const [target, name] = inventory[0].split('/');
    const actual = selectFocusedIosTests(
      `ios/${profile}`,
      `apps/mobile/ios/${target}/${name}.swift`,
      id,
    );
    assert.deepEqual(actual.identifiers, grouped ? inventory : [id]);
    assert.equal(actual.expectedCount, grouped ? inventory.length : 1);
    assert.equal(actual.profile, profile);
    assert.equal(
      actual.mode,
      grouped
        ? profile
        : ['fixtures', 'microphone', 'health-import', 'provider-selection'].includes(profile)
          ? 'fixture'
          : 'plain',
    );
  });
}

test('UI focus preserves its integration app-host preparation while an integration core selection stays integration-only', () => {
  const ui = selectFocusedIosTests(
    'ios/core',
    'apps/mobile/ios/OrotUITests/TestHostConnectionTests.swift',
    'OrotUITests/TestHostConnectionTests/testHostLaunches',
  );
  assert.equal(ui.suite, 'ui');
  assert.equal(ui.prepareUi, true);
  const integration = selectFocusedIosTests(
    'ios/core',
    'apps/mobile/ios/OrotIntegrationTests/HermesDomainIntegrationTests.swift',
    'OrotIntegrationTests/HermesDomainIntegrationTests/testHostExecutesHermesOperations',
  );
  assert.equal(integration.prepareUi, false);
});

test('named fixture focus binds its complete group to the governing inventory without partial method selection', () => {
  const file = 'scripts/ci/ios-test-fixture-groups.mjs';
  for (const suite of ['navigation', 'recordings', 'questions', 'calendar', 'all']) {
    const selection = selectFocusedIosTests(
      'ios/fixtures',
      file,
      suite === 'all' ? 'all' : `group/${suite}`,
    );
    assert.deepEqual(selection.identifiers, iosTestInventory('fixtures', suite));
    assert.equal(selection.fixtureSuite, suite);
    assert.equal(selection.mode, 'fixture');
    assert.equal(selection.identifier, '');
    assert.equal(selection.prepareUi, true);
  }
  assert.throws(() => selectFocusedIosTests('ios/fixtures', file, 'group/unknown'));
  assert.throws(() => selectFocusedIosTests('ios/core', file, 'group/navigation'));
  assert.throws(() => selectFocusedIosTests('ios/fixtures', 'other.mjs', 'group/navigation'));
});

test('wrong profile, source path, fragments and incomplete stateful phase selections cannot run', () => {
  const id = 'OrotUITests/TestHostConnectionTests/testHostLaunches';
  const file = 'apps/mobile/ios/OrotUITests/TestHostConnectionTests.swift';
  for (const args of [
    ['core', file, id],
    ['ios/unknown', file, id],
    ['ios/core', '../' + file, id],
    ['ios/core', file, 'testHostLaunches'],
    ['ios/core', file, id + '\n'],
    ['ios/fixtures', file, id],
    ['ios/core', file, ['all']],
    [
      'ios/backup',
      'apps/mobile/ios/OrotUITests/BackupPersistenceUITests.swift',
      iosTestInventory('backup')[0],
    ],
    [
      'ios/local-model',
      'apps/mobile/ios/OrotIntegrationTests/LocalModelIntegrationTests.swift',
      iosTestInventory('local-model')[0],
    ],
  ])
    assert.throws(() => selectFocusedIosTests(...args));
});

test('focused consumer verifies exact products before its only boot and retains strict selected-case verification', () => {
  const source = readFileSync('.github/workflows/ios-focused.yml', 'utf8');
  const execution = readFileSync('scripts/ci/run-ios-focused-tests.sh', 'utf8');
  const action = readFileSync('.github/actions/ios-test-products-build/action.yml', 'utf8');
  const biometricCapabilities = readFileSync(
    'scripts/ci/ios-simulator-biometric-capabilities.sh',
    'utf8',
  );
  assert.match(
    source,
    /Record hosted Simulator biometric controls\n\s+if: needs\.products\.outputs\.mode == 'authentication'/,
  );
  assert.match(source, /ios-simulator-biometric-capabilities\.sh/);
  assert.match(biometricCapabilities, /xcrun simctl help/);
  assert.match(biometricCapabilities, /xcrun simctl help io/);
  assert.ok(
    source.indexOf('Verify product provenance and integrity before boot') <
      source.indexOf('Boot the dedicated execution destination'),
  );
  assert.equal((source.match(/ios-test-simulator\.mjs prepare/g) ?? []).length, 1);
  assert.match(source, /needs: products/);
  assert.match(source, /ARCHIVE_DIGEST: \$\{\{ needs\.products\.outputs\.archive_digest \}\}/);
  assert.match(source, /MANIFEST_DIGEST: \$\{\{ needs\.products\.outputs\.manifest_digest \}\}/);
  assert.match(source, /run-ios-focused-tests\.sh "\$PROFILE" "\$MODE" "\$TEST_ID"/);
  assert.match(execution, /ios-test-results\.mjs "\$profile"[^\n]*"\$test_id"/);
  assert.match(execution, /authentication\)[\s\S]*run-ios-tests\.mjs/);
  assert.match(execution, /run-ios-fixture-tests\.mjs "\$@"/);
  assert.match(
    execution,
    /backup \| local-model \| speech-journey \| fixture-isolation \| recording-persistence \| state-persistence\)/,
  );
  assert.doesNotMatch(
    source,
    /continue-on-error|build-ios-tests\.mjs|test-with-building|test-iterations/,
  );
  assert.match(action, /build-ios-tests\.mjs "\$PROFILE"/);
  // Registry cleanup is allowed; booting remains reserved for the verified consumer step.
  assert.deepEqual(action.match(/(?:xcrun\s+)?simctl\b[^\n]*/g) ?? [], [
    'xcrun simctl delete unavailable',
  ]);
  assert.doesNotMatch(action, /ios-test-simulator/);
  assert.match(source, /Tear down the owned destination\n\s+if: always\(\)/);
  assert.match(source, /Preserve integration execution diagnostics\n\s+if: always\(\)/);
});
