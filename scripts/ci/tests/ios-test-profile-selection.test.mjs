import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { fixture } from './fixtures/ios-test-runner.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { selectIosTestProfileForSelection } from '../ios-test-profile-selection.mjs';

test('shared picker journeys honor their valid profile and reject a foreign fixture selection', () => {
  const healthInventory = iosTestInventory('health-import');
  const pickerJourney = healthInventory.find((identifier) =>
    identifier.includes('/MedicalDocumentImportJourneyUITests/'),
  );
  const foreignFixture = iosTestInventory('fixtures').find(
    (identifier) => !healthInventory.includes(identifier),
  );
  const accepted = fixture(0, 'health-import', 'all', [pickerJourney]);
  try {
    assert.equal(accepted.outcome.status, 0, accepted.outcome.stderr);
    assert.deepEqual(
      accepted.calls
        .find((call) => call.name === 'xcodebuild')
        .args.filter((argument) => argument.startsWith('-only-testing:')),
      ['-only-testing:' + pickerJourney],
    );
  } finally {
    rmSync(accepted.directory, { recursive: true, force: true });
  }
  const rejected = fixture(0, 'health-import', 'all', [foreignFixture]);
  try {
    assert.notEqual(rejected.outcome.status, 0);
    assert.match(rejected.outcome.stderr, /dedicated host-orchestrated destination/);
    assert.ok(!rejected.calls.some((call) => call.name === 'xcodebuild'));
  } finally {
    rmSync(rejected.directory, { recursive: true, force: true });
  }
});

test('a shared fixture and Duo case follows the explicitly requested Duo profile', () => {
  const fixtureInventory = iosTestInventory('fixtures');
  const duoInventory = iosTestInventory('duo');
  const sharedCase = fixtureInventory.find((identifier) => duoInventory.includes(identifier));
  assert.ok(sharedCase);
  const accepted = fixture(0, 'duo', 'all', [sharedCase]);
  try {
    assert.equal(accepted.outcome.status, 0, accepted.outcome.stderr);
    assert.deepEqual(
      accepted.calls
        .find((call) => call.name === 'xcodebuild')
        .args.filter((argument) => argument.startsWith('-only-testing:')),
      ['-only-testing:' + sharedCase],
    );
  } finally {
    rmSync(accepted.directory, { recursive: true, force: true });
  }
  const profileCandidates = [
    'fixtures',
    'health-import',
    'microphone',
    'provider-selection',
    'duo',
  ];
  assert.equal(selectIosTestProfileForSelection('duo', profileCandidates, [sharedCase]), 'duo');
});

test('a complete Duo selection remains available without fixture-session restrictions', () => {
  const accepted = fixture(0, 'duo');
  try {
    assert.equal(accepted.outcome.status, 0, accepted.outcome.stderr);
    assert.deepEqual(
      accepted.calls
        .find((call) => call.name === 'xcodebuild')
        .args.filter((argument) => argument.startsWith('-only-testing:')),
      iosTestInventory('duo').map((identifier) => '-only-testing:' + identifier),
    );
  } finally {
    rmSync(accepted.directory, { recursive: true, force: true });
  }
});

test('a standard Core selection keeps its destination when a case also appears in the Duo profile', () => {
  const sharedCoreCase = iosTestInventory('core').find((identifier) =>
    iosTestInventory('duo').includes(identifier),
  );
  assert.ok(sharedCoreCase);
  const accepted = fixture(0, 'core', 'all', [sharedCoreCase]);
  try {
    assert.equal(accepted.outcome.status, 0, accepted.outcome.stderr);
    assert.ok(
      accepted.calls
        .find((call) => call.name === 'xcodebuild')
        .args.includes('-only-testing:' + sharedCoreCase),
    );
  } finally {
    rmSync(accepted.directory, { recursive: true, force: true });
  }
});

test('an explicit Duo run fails closed when its selected cases are not all in the Duo inventory', () => {
  const duoInventory = iosTestInventory('duo');
  const foreignFixture = iosTestInventory('fixtures').find(
    (identifier) => !duoInventory.includes(identifier),
  );
  const rejected = fixture(0, 'duo', 'all', [duoInventory[0], foreignFixture]);
  try {
    assert.notEqual(rejected.outcome.status, 0);
    assert.match(rejected.outcome.stderr, /dedicated host-orchestrated destination/);
    assert.ok(!rejected.calls.some((call) => call.name === 'xcodebuild'));
  } finally {
    rmSync(rejected.directory, { recursive: true, force: true });
  }
});
