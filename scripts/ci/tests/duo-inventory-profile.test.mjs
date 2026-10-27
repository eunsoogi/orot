import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestBuildSpec } from '../ios-test-config.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

// This suite binds the Duo destination to its exact native test inventory.
test('Duo remains opt-in with its own product compatibility and exact native test inventory', () => {
  const duo = iosTestBuildSpec('duo');
  const core = iosTestBuildSpec('core');
  assert.equal(duo.productProfile, 'ios-test-duo');
  assert.deepEqual(duo.compatibleExecutions, ['duo']);
  assert.deepEqual(core.compatibleExecutions, [
    'core',
    'speech',
    'backup',
    'fixtures',
    'local-model',
  ]);
  assert.deepEqual(iosTestBuildSpec('provider-data').compatibleExecutions, [
    'provider-data',
    'health-import',
    'microphone',
    'provider-selection',
  ]);
  const buildInputs = (spec) =>
    Object.fromEntries(
      Object.entries(spec).filter(
        ([key]) => !['productProfile', 'compatibleExecutions'].includes(key),
      ),
    );
  assert.deepEqual(buildInputs(duo), buildInputs(core));
  const duoInventory = iosTestInventory('duo');
  const iPhoneFixtures = iosTestInventory('fixtures');
  const coreTests = iosTestInventory('core');
  const contextualDeparture =
    'OrotUITests/ManualHistoryUITests/testContextualBackAndHomeHonorDepartureConfirmationInRightRail';
  const manualHistoryRecovery =
    'OrotUITests/ManualHistoryUITests/testRouteOpenFailureRetryAndBackAfterDuoReflow';
  const manualHistoryReflow =
    'OrotUITests/ManualHistoryDuoUITests/testSelectedHistorySurvivesMeasuredDuoReflow';
  const homeSummary =
    'OrotUITests/HomeDuoUITests/testHomeSummariesReflowAndVisitPreparationRemainsReachable';
  const aiFeatureEntry =
    'OrotUITests/FeatureEntryDuoUITests/testFeatureEntryActionsStayWithinContentLaneAfterOrientationChange';
  const settingsHome =
    'OrotUITests/RootNavigationUITests/testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText';
  const settingsAccounts =
    'OrotUITests/RootNavigationUITests/testSettingsAccountsLayoutTracksMeasuredPanels';
  const settingsProvider =
    'OrotUITests/RootNavigationUITests/testSettingsProviderLayoutTracksMeasuredPanels';
  const providerSelectionReflow =
    'OrotUITests/RootNavigationUITests/testProviderSelectionOverlayKeepsUnavailableProviderDisabledAcrossMeasuredDuoReflow';
  const settingsBackup =
    'OrotUITests/RootNavigationUITests/testBackupRecoveryReflowsWithinMeasuredDuoRegionsAndRemainsReachable';
  const privacySettingsReflow =
    'OrotUITests/SettingsPrivacyDuoUITests/testConsentConfirmationAndClearedStateSurviveDuoReflow';
  const recordsHub =
    'OrotUITests/RecordsHubUITests/testRecordsLaneSurvivesOrientationAndAppearanceChangesAtDefaultAndLargeText';
  const healthLibraryReflow =
    'OrotUITests/RecordsHubUITests/testHealthRecordTypeAndPeriodSurviveOrientationChanges';
  const healthImportLibrary =
    'OrotUITests/HealthImportDuoUITests/testHealthRecordsLibraryOpensTheUnifiedImportRoute';
  const healthDataSettingsReflow =
    'OrotUITests/HealthImportDuoUITests/testHealthDataSettingsReflowKeepsSelectionAndPermissionDisclosure';
  const diseaseHypothesesReflow =
    'OrotUITests/DiseaseHypothesesDuoUITests/testDuoReflowPreservesSelectedEvidenceAndSummaryActions';
  const healthImportReflow =
    'OrotUITests/HealthImportDuoUITests/testSelectedSourcesAndPendingImportSurviveDuoGeometryChanges';
  const healthImportLargeText =
    'OrotUITests/HealthImportDuoUITests/testLargeTextUsesOneReadableColumnForThePendingImport';
  const healthRecordDetailReflow =
    'OrotUITests/HealthImportDuoUITests/testHealthRecordPeriodAndRowsSurviveDuoGeometryChanges';
  const medicationHistoryReflow =
    'OrotUITests/HealthImportDuoUITests/testMedicationHistoryAndPeriodSurviveDuoReflow';
  const syncStatusReflow =
    'OrotUITests/SettingsSyncStatusDuoUITests/testSyncStatusAndRecoveryStayInsideDuoRegionsAcrossReflow';
  const recordingLiveReflow =
    'OrotUITests/RecordingDuoUITests/testRecordingCaptureAndConsentSurviveLiveWindowReflow';
  const recordingReviewReflow =
    'OrotUITests/RecordingDuoUITests/testRecordingReviewRetainsTranscriptDraftAndSelectionAcrossWindowReflow';
  const savedRecordingsSelectionSummary =
    'OrotUITests/RecordingLibraryUITests/testSavedRecordingsSelectionSummaryReflowsAfterReturningFromReview';
  const duoKeyboardSave =
    'OrotUITests/NextVisitReviewUITests/testDuoRightRailKeepsKeyboardSaveInsideTheContentLane';
  const fourSidedOcclusion =
    'OrotUITests/SafeAreaNavigationUITests/testSystemInsetsAcrossHomeHealthImportRecordingAndBloodPressureLibrary';
  const scheduleReflow =
    'OrotUITests/ScheduleCalendarUITests/testSelectedAppointmentSurvivesDarkLandscapeReflowAndConfirmation';
  const scheduleLargeText =
    'OrotUITests/ScheduleCalendarUITests/testLargeTextKeepsScheduleConfirmationReachable';
  const appointmentsReflow =
    'OrotUITests/AppointmentsUITests/testAppointmentSelectionDetailsReflowAcrossDuoGeometry';
  const classificationReflow =
    'OrotUITests/AppointmentConsentUITests/testDisclosureBlocksProviderUntilApprovalAndNeverSavesFailedClassification';
  const recordingShareDismissal =
    'OrotUITests/RecordingExportUITests/testActualAudioShareDismissalCleansTemporaryFilesAndPreservesSource';
  const standardKeyboardSave =
    'OrotUITests/NextVisitReviewUITests/testSaveRemainsAboveTheActualKeyboardWhileEditingTheThirdQuestion';
  // Keep account, provider, sync, history, disease-summary, backup, privacy, and health settings explicit.
  assert.equal(duoInventory.length, 35);
  assert.deepEqual(duoInventory, [
    'OrotUITests/TestHostConnectionTests/testHostLaunches',
    'OrotUITests/RootNavigationUITests/testRightRailKeepsAccessibleRootAndContextualNavigation',
    homeSummary,
    settingsHome,
    settingsAccounts,
    settingsProvider,
    providerSelectionReflow,
    settingsBackup,
    privacySettingsReflow,
    aiFeatureEntry,
    'OrotUITests/WindowGeometryUITests/testDuoGeometryEventsMatchUIKitAndRetainQuestionDraftAcrossSourceNavigation',
    'OrotUITests/OrientationPresentationAnchorUITests/testLandscapeTransitionRetainsQuestionDraftAndSourceRoute',
    scheduleReflow,
    scheduleLargeText,
    appointmentsReflow,
    classificationReflow,
    contextualDeparture,
    manualHistoryRecovery,
    manualHistoryReflow,
    duoKeyboardSave,
    fourSidedOcclusion,
    recordingShareDismissal,
    recordsHub,
    healthLibraryReflow,
    healthImportLibrary,
    healthDataSettingsReflow,
    diseaseHypothesesReflow,
    healthImportReflow,
    healthImportLargeText,
    healthRecordDetailReflow,
    medicationHistoryReflow,
    syncStatusReflow,
    recordingLiveReflow,
    recordingReviewReflow,
    savedRecordingsSelectionSummary,
  ]);
  // Home stays in iPhone fixtures; privacy, feature-entry, manual-history,
  // records, and Duo-only health-import regressions use the dedicated destination.
  assert.ok(iPhoneFixtures.includes(homeSummary));
  assert.ok(!iPhoneFixtures.includes(aiFeatureEntry));
  assert.ok(!iPhoneFixtures.includes(settingsHome));
  assert.ok(!iPhoneFixtures.includes(settingsBackup));
  assert.ok(!coreTests.includes(homeSummary));
  assert.ok(!coreTests.includes(aiFeatureEntry));
  assert.ok(!coreTests.includes(settingsHome));
  assert.ok(!coreTests.includes(settingsBackup));
  assert.ok(!iPhoneFixtures.includes(recordsHub));
  assert.ok(!coreTests.includes(recordsHub));
  for (const duoOnlyCase of [
    manualHistoryRecovery,
    settingsAccounts,
    privacySettingsReflow,
    healthLibraryReflow,
    healthDataSettingsReflow,
    diseaseHypothesesReflow,
    healthImportLibrary,
    healthImportReflow,
    healthImportLargeText,
    medicationHistoryReflow,
  ]) {
    assert.ok(!iPhoneFixtures.includes(duoOnlyCase));
    assert.ok(!coreTests.includes(duoOnlyCase));
  }
  assert.ok(iPhoneFixtures.includes(standardKeyboardSave));
  assert.ok(iPhoneFixtures.includes(scheduleReflow));
  assert.ok(iPhoneFixtures.includes(scheduleLargeText));
  assert.ok(iPhoneFixtures.includes(fourSidedOcclusion));
  assert.ok(coreTests.includes(recordingShareDismissal));
  const navigationImports = iosTestCohortTasks('navigation-imports').flatMap(
    (task) => task.identifiers,
  );
  const recordingEvidence = iosTestCohortTasks('recording-evidence').flatMap(
    (task) => task.identifiers,
  );
  assert.ok(navigationImports.includes(fourSidedOcclusion));
  assert.ok(recordingEvidence.includes(recordingShareDismissal));
  assert.ok(!duoInventory.includes(standardKeyboardSave));
  assert.ok(!iPhoneFixtures.includes(contextualDeparture));
  assert.ok(!iPhoneFixtures.includes(duoKeyboardSave));
  assert.ok(!coreTests.includes(contextualDeparture));
  assert.ok(!coreTests.includes(duoKeyboardSave));
  assert.ok(
    coreTests.includes(
      'OrotIntegrationTests/NavigationLayoutIntegrationTests/testContextualDisabledAccessibilityTracksUIKitStateWithoutTabSelection',
    ),
  );
  assert.throws(() => iosTestInventory('duo', 'integration'), /Unsupported/);
  assert.throws(() => iosTestInventory('duo', 'navigation'), /Unsupported/);
  assert.ok(iosTestExecutionPlan().every((job) => job.profile !== 'duo'));
});
