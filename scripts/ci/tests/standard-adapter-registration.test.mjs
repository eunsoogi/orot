import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestImpactForPath } from '../ios-test-impact.mjs';

test('standard adapter bridge coverage is scheduled exactly once by the provider cohort', () => {
  const identifier =
    'OrotIntegrationTests/StandardAdapterIntegrationTests/testStandardAdaptersPreserveNativeDispatchSchemasToolsUsageAndCancellation';
  assert.ok(iosTestInventory('provider-data').includes(identifier));
  const scheduled = iosTestCohortTasks('provider').flatMap((task) => task.identifiers);
  assert.equal(scheduled.filter((value) => value === identifier).length, 1);
  for (const path of [
    'apps/mobile/ios/OrotIntegrationTests/StandardAdapterIntegrationTests.swift',
    'apps/mobile/e2e/standardAdaptersProbe.ts',
    'apps/mobile/e2e/standardAdaptersAppleProbe.ts',
    'apps/mobile/e2e/standardAdaptersOpenAIProbe.ts',
  ])
    assert.deepEqual(iosTestImpactForPath(path).cohorts, ['provider']);
});

test('an unregistered adapter lookalike retains the unknown helper fallback', () => {
  const unknown = iosTestImpactForPath('apps/mobile/e2e/standardAdaptersUnregisteredProbe.ts');
  assert.equal(unknown.reason, 'unknown-e2e-impact');
  assert.deepEqual(
    unknown.cohorts,
    iosTestImpactForPath('apps/mobile/e2e/unregisteredProbe.ts').cohorts,
  );
});

test('integrated native inventory retains manual history, standard adapters, geometry and reminders', () => {
  const manual = [
    'testKnownDateProvenanceAndCorrectionSurviveProcessRestart',
    'testUnknownDateAndConfirmedLineageDeletionSurviveProcessRestart',
    'testUnsavedDraftRequiresConfirmationBeforeLeavingManualHistory',
  ].map((method) => 'OrotUITests/ManualHistoryUITests/' + method);
  const calendar = iosTestCohortTasks('calendar-appointments').flatMap((task) => task.identifiers);
  for (const identifier of manual)
    assert.equal(calendar.filter((value) => value === identifier).length, 1);
  const full = ['release', 'debug', 'speech'].flatMap((cohort) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  );
  assert.equal(full.length, 172);
  assert.equal(new Set(full).size, 169);
  for (const identifier of [
    ...manual,
    'OrotIntegrationTests/StandardAdapterIntegrationTests/testStandardAdaptersPreserveNativeDispatchSchemasToolsUsageAndCancellation',
    'OrotUITests/WindowGeometryUITests/testIPhoneGeometryEventsMatchUIKitAndRetainQuestionDraftAcrossSourceNavigation',
    'OrotUITests/AppointmentReminderJourneyUITests/testReminderControlsAndPreparationAcrossAppearancesAndLargeText',
  ])
    assert.equal(full.filter((value) => value === identifier).length, 1);
});
