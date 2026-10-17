import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { iosTestImpactForPath } from '../ios-test-impact.mjs';

const sorted = (value) => value.slice().sort();

test('recording source changes retain every stateful and native recording dependent', () => {
  const impact = iosTestImpactForPath('apps/mobile/src/recording/recordingController.ts');

  assert.deepEqual(
    sorted(impact.cohorts),
    sorted([
      'core-integration',
      'persistence',
      'isolation',
      'backup',
      'recordings',
      'microphone',
      'speech',
    ]),
  );
  assert.equal(impact.oauth, false);
});

test('visit-question source changes select its provider and question suites only', () => {
  const impact = iosTestImpactForPath(
    'apps/mobile/src/nextVisitQuestions/NextVisitQuestionsRoute.tsx',
  );

  assert.deepEqual(sorted(impact.cohorts), sorted(['core-integration', 'questions', 'provider']));
});

test('native test files map to the cohort that owns their original assertions', () => {
  const backup = iosTestImpactForPath('apps/mobile/ios/OrotUITests/BackupPersistenceUITests.swift');
  const health = iosTestImpactForPath('apps/mobile/ios/OrotMobile/HealthKitAuthorization.swift');

  assert.deepEqual(backup.cohorts, ['backup']);
  assert.deepEqual(
    sorted(health.cohorts),
    sorted(['core-integration', 'health', 'calendar', 'provider', 'questions']),
  );
});

test('maintained native tests select each cohort that owns their assertions', () => {
  const cases = [
    ['apps/mobile/ios/OrotUITests/RecordingExportUITests.swift', ['core-ui']],
    ['apps/mobile/ios/OrotUITests/TranscriptEvidenceUITests.swift', ['core-ui']],
    ['apps/mobile/ios/OrotUITests/PagedHealthRecordsUITests.swift', ['navigation']],
    ['apps/mobile/ios/OrotUITests/UnifiedImportUITests.swift', ['core-ui', 'health', 'navigation']],
    ['apps/mobile/ios/OrotUITests/StorageMigrationUITests.swift', ['calendar']],
    [
      'apps/mobile/ios/OrotIntegrationTests/NavigationLayoutIntegrationTests.swift',
      ['core-integration'],
    ],
  ];

  for (const [path, owners] of cases) {
    assert.ok(existsSync(path), `${path} must remain in the maintained test inventory`);
    const impact = iosTestImpactForPath(path);
    assert.deepEqual(
      [...impact.cohorts].sort(),
      [...owners].sort(),
      `${path} must select exactly its maintained owners`,
    );
  }
});

test('domain E2E helpers are focused while shared test drivers keep the full inventory', () => {
  const calendar = iosTestImpactForPath('apps/mobile/e2e/calendarClassificationTestOperation.ts');
  const shared = iosTestImpactForPath('apps/mobile/e2e/domainTestOperations.ts');

  assert.deepEqual(sorted(calendar.cohorts), sorted(['calendar', 'provider', 'questions']));
  assert.equal(shared.reason, 'shared-test-driver');
  assert.equal(shared.cohorts.length, 15);
});

test('unknown application and shared package changes select all dependent suites', () => {
  const unknown = iosTestImpactForPath('apps/mobile/src/newFeature/NewFeature.tsx');
  const shared = iosTestImpactForPath('packages/model-runtime/src/session.ts');

  assert.equal(unknown.reason, 'unknown-application-impact');
  assert.equal(unknown.cohorts.length, 15);
  assert.equal(shared.reason, 'shared-package');
  assert.equal(shared.cohorts.length, 15);
});

test('new or unclassified native and E2E test files fail safe to the full suite', () => {
  for (const path of [
    'apps/mobile/ios/OrotIntegrationTests/NewFeatureTests.swift',
    'apps/mobile/ios/OrotUITests/NewFeatureUITests.swift',
    'apps/mobile/e2e/newFeatureTestOperation.ts',
  ]) {
    const impact = iosTestImpactForPath(path);

    assert.equal(impact.cohorts.length, 15, path);
    assert.ok(impact.reason.startsWith('unknown-'), path);
  }
});

test('provider-openai package changes also select the separate OAuth suite', () => {
  const impact = iosTestImpactForPath('packages/provider-openai/Sources/OAuth/Session.swift');

  assert.equal(impact.oauth, true);
  assert.equal(impact.cohorts.length, 15);
});
