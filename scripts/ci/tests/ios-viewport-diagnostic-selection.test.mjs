import assert from 'node:assert/strict';
import test from 'node:test';
import { duoAcceptanceDiagnosticTests } from '../ios-acceptance-diagnostic-inventory.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { resolveIosTestProfileSelection } from '../ios-test-profile-selection.mjs';

const journey =
  'OrotUITests/RootNavigationUITests/testLargeTextKeepsRootTabsAndRecordingActionsReachable';

// Destination admission does not establish native execution or successful geometry.
test('long-content observation retains fixtures and admits only explicit single Duo selection', () => {
  assert.ok(duoAcceptanceDiagnosticTests.includes(journey));
  assert.ok(iosTestInventory('fixtures').includes(journey));
  assert.ok(!iosTestInventory('duo').includes(journey));
  assert.deepEqual(resolveIosTestProfileSelection('duo', [journey]), {
    fixtureSelection: null,
    hostPreparation: false,
    isFixtureProfile: false,
  });
  assert.deepEqual(resolveIosTestProfileSelection('fixtures', [journey]), {
    fixtureSelection: 'fixtures',
    hostPreparation: false,
    isFixtureProfile: true,
  });
  assert.throws(
    () => resolveIosTestProfileSelection('duo', [journey, iosTestInventory('duo')[0]]),
    /explicit single journey/,
  );
  assert.throws(
    () => resolveIosTestProfileSelection('core', [journey]),
    /Duo or their existing fixture profile/,
  );
});
