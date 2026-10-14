import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { selectFocusedIosTests, verifyFocusedIosPullRequest } from '../ios-focused-selection.mjs';

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
for (const profile of profiles) {
  test(`integration focus preserves exact ${profile} selection and its isolation mode`, () => {
    const inventory = iosTestInventory(profile);
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

test('PR focus binds the actual workflow branch, repository and exact open head', () => {
  const context = {
    repository: 'eunsoogi/orot',
    sha: 'a'.repeat(40),
    ref: 'eunsoogi/issue-198-ci-build-reuse',
  };
  const pr = {
    number: 200,
    state: 'open',
    head: { repo: { full_name: context.repository }, sha: context.sha, ref: context.ref },
  };
  assert.doesNotThrow(() => verifyFocusedIosPullRequest(context, '200', pr));
  for (const change of [
    { number: 201 },
    { state: 'closed' },
    { head: { ...pr.head, sha: 'b'.repeat(40) } },
    { head: { ...pr.head, ref: 'main' } },
    { head: { ...pr.head, repo: { full_name: 'other/orot' } } },
  ])
    assert.throws(() => verifyFocusedIosPullRequest(context, '200', { ...pr, ...change }));
  for (const number of ['0', '0200', '200;echo', '200\n'])
    assert.throws(() => verifyFocusedIosPullRequest(context, number, pr));
});

test('integration focus routing leaves full protected statuses failing without a legacy fallback', () => {
  const dispatcher = readFileSync('.github/workflows/e2e-test.yml', 'utf8');
  assert.match(
    dispatcher,
    /focused_scenario:[\s\S]*uses: \.\/\.github\/workflows\/ios-focused\.yml/,
  );
  assert.match(dispatcher, /DIAGNOSTIC: \$\{\{ needs\.selection\.outputs\.diagnostic \}\}/);
  assert.match(dispatcher, /test "\$DIAGNOSTIC" != true/);
  assert.doesNotMatch(dispatcher, /detox-e2e-focused|e2e-focused\.yml/);
});

test('focused consumer verifies exact products before its only boot and retains strict selected-case verification', () => {
  const source = readFileSync('.github/workflows/ios-focused.yml', 'utf8');
  const action = readFileSync('.github/actions/ios-test-products-build/action.yml', 'utf8');
  assert.ok(
    source.indexOf('Verify product provenance and integrity before boot') <
      source.indexOf('Boot the dedicated execution destination'),
  );
  assert.equal((source.match(/ios-test-simulator\.mjs prepare/g) ?? []).length, 1);
  assert.match(source, /needs: products/);
  assert.match(source, /ARCHIVE_DIGEST: \$\{\{ needs\.products\.outputs\.archive_digest \}\}/);
  assert.match(source, /MANIFEST_DIGEST: \$\{\{ needs\.products\.outputs\.manifest_digest \}\}/);
  assert.match(source, /ios-test-results\.mjs "\$PROFILE"[^\n]*"\$TEST_ID"/);
  assert.match(source, /run-ios-fixture-tests\.mjs "\$PROFILE"[^\n]*"\$TEST_ID"/);
  assert.match(source, /run-ios-backup-tests\.mjs/);
  assert.match(source, /run-ios-local-model-tests\.mjs/);
  assert.doesNotMatch(
    source,
    /continue-on-error|build-ios-tests\.mjs|test-with-building|test-iterations/,
  );
  assert.match(action, /build-ios-tests\.mjs "\$PROFILE"/);
  assert.doesNotMatch(action, /simctl|ios-test-simulator/);
  assert.match(source, /Tear down the owned destination\n\s+if: always\(\)/);
  assert.match(source, /Preserve integration execution diagnostics\n\s+if: always\(\)/);
});
