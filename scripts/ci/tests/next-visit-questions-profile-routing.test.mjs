import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

// Consent, cited review, keyboard reachability and relaunch are mandatory native replacements for the retired screen runner.
test('full Release retains every next-visit and consent journey in its fixture groups', () => {
  const fixtures = iosTestInventory('fixtures');
  for (const method of [
    'testNativeSaveRemainsAboveTheActualKeyboardWhileEditingTheThirdQuestion',
    'testCitedReviewSaveCancelAndReloadRetainTheSavedQuestionsAcrossAppearanceChanges',
    'testDeclinedRemoteConsentStopsSendsAndCitedQuestionsRemainReviewable',
  ])
    assert.equal(fixtures.filter((id) => id.endsWith('/' + method)).length, 1);
  const scheduled = iosTestCohortTasks('release').flatMap((task) => task.identifiers);
  for (const identifier of fixtures) assert.ok(scheduled.includes(identifier));
});
