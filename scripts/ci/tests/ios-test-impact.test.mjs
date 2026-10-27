import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestImpactForPath } from '../ios-test-impact.mjs';

const sorted = (value) => value.slice().sort();

test('recording source changes retain stateful and native recording-export dependents', () => {
  const impact = iosTestImpactForPath('apps/mobile/src/recording/recordingController.ts');

  assert.deepEqual(
    sorted(impact.cohorts),
    sorted([
      'core-integration',
      'core-ui',
      'recording-evidence',
      'persistence',
      'isolation',
      'backup',
      'recordings-controls',
      'recordings-review',
      'recordings-playback',
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

  assert.deepEqual(
    sorted(impact.cohorts),
    sorted([
      'core-integration',
      'questions-review',
      'questions-conversation',
      'questions-accessibility',
      'questions-summary',
      'questions-literature',
      'provider',
    ]),
  );
});

test('recording evidence retains its native geometry and synthetic entry dependents', () => {
  for (const path of [
    'apps/mobile/ios/OrotUITests/ExportDismissalGeometry.swift',
    'apps/mobile/e2e/transcription/recordingExportProbeDiagnostics.ts',
  ]) {
    assert.ok(existsSync(path));
    assert.ok(iosTestImpactForPath(path).cohorts.includes('recording-evidence'), path);
  }
});

test('native test files map to the cohort that owns their original assertions', () => {
  const backup = iosTestImpactForPath('apps/mobile/ios/OrotUITests/BackupPersistenceUITests.swift');
  const health = iosTestImpactForPath('apps/mobile/ios/OrotMobile/HealthKitAuthorization.swift');

  assert.deepEqual(backup.cohorts, ['backup']);
  assert.deepEqual(
    sorted(health.cohorts),
    sorted([
      'core-integration',
      'health-observations',
      'health-recovery',
      'calendar-consent',
      'calendar-appointments',
      'provider',
      'questions-review',
      'questions-conversation',
      'questions-accessibility',
      'questions-summary',
      'questions-literature',
    ]),
  );
});

test('maintained native tests select each cohort that owns their assertions', () => {
  const cases = [
    ['apps/mobile/ios/OrotUITests/RecordingExportUITests.swift', ['recording-evidence']],
    ['apps/mobile/ios/OrotUITests/TranscriptEvidenceUITests.swift', ['recording-evidence']],
    [
      'apps/mobile/ios/OrotUITests/OrientationPresentationAnchorUITests.swift',
      ['navigation-features'],
    ],
    [
      'apps/mobile/ios/OrotIntegrationTests/WindowPresentationAnchorIntegrationTests.swift',
      ['core-integration'],
    ],
    ['apps/mobile/ios/OrotUITests/PagedHealthRecordsUITests.swift', ['navigation-routes']],
    [
      'apps/mobile/ios/OrotUITests/UnifiedImportUITests.swift',
      ['core-ui', 'health-observations', 'health-recovery', 'navigation-imports'],
    ],
    ['apps/mobile/ios/OrotUITests/StorageMigrationUITests.swift', ['calendar-appointments']],
    ['apps/mobile/ios/OrotUITests/ManualHistoryUITests.swift', ['calendar-appointments']],
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

test('source paths include cohorts owning their maintained native dependent tests', () => {
  const cases = [
    {
      sourcePath: 'apps/mobile/src/transcription/TranscriptCorrectionEditor.tsx',
      testPath: 'apps/mobile/ios/OrotUITests/TranscriptEvidenceUITests.swift',
      cohort: 'recording-evidence',
      identifier:
        'OrotUITests/TranscriptEvidenceUITests/testNativeReviewHistoryPlaybackAndDeleteConfirmation',
    },
    {
      sourcePath: 'apps/mobile/src/recording/RecordingExportPanel.tsx',
      testPath: 'apps/mobile/ios/OrotUITests/RecordingExportUITests.swift',
      cohort: 'recording-evidence',
      identifier:
        'OrotUITests/RecordingExportUITests/testActualAudioShareDismissalCleansTemporaryFilesAndPreservesSource',
    },
    {
      sourcePath: 'apps/mobile/src/recording/recordingExportService.ts',
      testPath: 'apps/mobile/ios/OrotUITests/RecordingExportUITests.swift',
      cohort: 'recording-evidence',
      identifier:
        'OrotUITests/RecordingExportUITests/testActualAudioShareDismissalCleansTemporaryFilesAndPreservesSource',
    },
    {
      sourcePath: 'apps/mobile/src/navigation/nativeNavigationActions.ts',
      testPath: 'apps/mobile/ios/OrotIntegrationTests/NavigationLayoutIntegrationTests.swift',
      cohort: 'core-integration',
      identifier:
        'OrotIntegrationTests/NavigationLayoutIntegrationTests/testRootTabAccessibilityKeepsDisabledAndSelectedTraitsTogether',
    },
    {
      sourcePath: 'apps/mobile/ios/OrotMobile/WindowPresentationAnchor.swift',
      testPath:
        'apps/mobile/ios/OrotIntegrationTests/WindowPresentationAnchorIntegrationTests.swift',
      cohort: 'core-integration',
      identifier:
        'OrotIntegrationTests/WindowPresentationAnchorIntegrationTests/testAttachedCallerViewKeepsSystemFilePickerInItsOwningWindow',
    },
    {
      sourcePath: 'apps/mobile/ios/OrotMobile/WindowPresentationAnchor.swift',
      testPath: 'apps/mobile/ios/OrotUITests/RecordingExportUITests.swift',
      cohort: 'recording-evidence',
      identifier:
        'OrotUITests/RecordingExportUITests/testActualAudioShareDismissalCleansTemporaryFilesAndPreservesSource',
    },
    {
      sourcePath: 'apps/mobile/ios/OrotMobile/PopoverSourceRegion.swift',
      testPath: 'apps/mobile/ios/OrotIntegrationTests/RecordingExportIntegrationTests.swift',
      cohort: 'core-integration',
      identifier:
        'OrotIntegrationTests/RecordingExportIntegrationTests/testDefaultTranscriptSharePreservesItsExactWindowRegionUntilDismissal',
    },
    {
      sourcePath: 'apps/mobile/ios/OrotMobile/WindowPresentationAnchor.swift',
      testPath: 'apps/mobile/ios/OrotUITests/OrientationPresentationAnchorUITests.swift',
      cohort: 'navigation-features',
      identifier:
        'OrotUITests/OrientationPresentationAnchorUITests/testLandscapeTransitionRetainsQuestionDraftAndSourceRoute',
    },
  ];

  for (const { sourcePath, testPath, cohort, identifier } of cases) {
    assert.ok(existsSync(testPath), `${testPath} must remain maintained`);
    assert.ok(
      iosTestCohortTasks(cohort).some((task) => task.identifiers.includes(identifier)),
      `${identifier} must remain in the ${cohort} execution inventory`,
    );
    assert.ok(
      iosTestImpactForPath(testPath).cohorts.includes(cohort),
      `${testPath} must select its owning ${cohort} cohort`,
    );
    assert.ok(
      iosTestImpactForPath(sourcePath).cohorts.includes(cohort),
      `${sourcePath} must select the dependent test's ${cohort} cohort`,
    );
  }
});

test('domain E2E helpers are focused while shared test drivers keep the full inventory', () => {
  const calendar = iosTestImpactForPath('apps/mobile/e2e/calendarClassificationTestOperation.ts');
  const shared = iosTestImpactForPath('apps/mobile/e2e/domainTestOperations.ts');

  assert.deepEqual(
    sorted(calendar.cohorts),
    sorted([
      'calendar-consent',
      'calendar-appointments',
      'provider',
      'questions-review',
      'questions-conversation',
      'questions-accessibility',
      'questions-summary',
      'questions-literature',
    ]),
  );
  assert.equal(shared.reason, 'shared-test-driver');
  assert.equal(shared.cohorts.length, 27);
});

test('unknown application and shared package changes select all dependent suites', () => {
  const unknown = iosTestImpactForPath('apps/mobile/src/newFeature/NewFeature.tsx');
  const shared = iosTestImpactForPath('packages/model-runtime/src/session.ts');

  assert.equal(unknown.reason, 'unknown-application-impact');
  assert.equal(unknown.cohorts.length, 27);
  assert.equal(shared.reason, 'shared-package');
  assert.equal(shared.cohorts.length, 27);
});

test('new or unclassified native and E2E test files fail safe to the full suite', () => {
  for (const path of [
    'apps/mobile/ios/OrotIntegrationTests/NewFeatureTests.swift',
    'apps/mobile/ios/OrotUITests/NewFeatureUITests.swift',
    'apps/mobile/e2e/newFeatureTestOperation.ts',
  ]) {
    const impact = iosTestImpactForPath(path);

    assert.equal(impact.cohorts.length, 27, path);
    assert.ok(impact.reason.startsWith('unknown-'), path);
  }
});

test('provider-openai package changes also select the separate OAuth suite', () => {
  const impact = iosTestImpactForPath('packages/provider-openai/Sources/OAuth/Session.swift');

  assert.equal(impact.oauth, true);
  assert.equal(impact.cohorts.length, 27);
});
