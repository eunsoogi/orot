import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { fixture } from './fixtures/ios-test-runner.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

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
