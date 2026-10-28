import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestBuildSpec } from '../ios-test-config.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

// This suite pins the Duo selectors and keeps other profile memberships explicit.
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
  const providerAuthReflow =
    'OrotUITests/ProviderSelectionUITests/testAuthSessionCancellationRouteExitRetryAndCallbackKeepSelectionExplicit';
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
  const evidenceSourceReflow =
    'OrotUITests/EvidenceSourceDuoUITests/testEvidenceSourceDetailsReflowWithoutLosingReturnState';
  const healthImportReflow =
    'OrotUITests/HealthImportDuoUITests/testSelectedSourcesAndPendingImportSurviveDuoGeometryChanges';
  const healthImportLargeText =
    'OrotUITests/HealthImportDuoUITests/testLargeTextUsesOneReadableColumnForThePendingImport';
  const healthRecordDetailReflow =
    'OrotUITests/HealthImportDuoUITests/testHealthRecordPeriodAndRowsSurviveDuoGeometryChanges';
  const medicationHistoryReflow =
    'OrotUITests/HealthImportDuoUITests/testMedicationHistoryAndPeriodSurviveDuoReflow';
  const keyboardUndoReflow =
    'OrotUITests/KeyboardSafeAreaUITests/testConversationOutputComposerAndSwipeUndoAcrossAppearances';
  const syncStatusReflow =
    'OrotUITests/SettingsSyncStatusDuoUITests/testSyncStatusAndRecoveryStayInsideDuoRegionsAcrossReflow';
  const recordingLiveReflow =
    'OrotUITests/RecordingDuoUITests/testRecordingCaptureAndConsentSurviveLiveWindowReflow';
  const recordingReviewReflow =
    'OrotUITests/RecordingDuoUITests/testRecordingReviewRetainsTranscriptDraftAndSelectionAcrossWindowReflow';
  const activeTranscriptionReflow =
    'OrotUITests/AutomaticTranscriptionUITests/testActiveTranscriptionSurvivesDuoReflow';
  const savedDraftTranscription =
    'OrotUITests/AutomaticTranscriptionUITests/testScreenStopReachesSavedDraft';
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
  const manualAppointmentReflow =
    'OrotUITests/AppointmentConsentUITests/testManualAppointmentRetainsDraftAcrossDuoReflow';
  const recordingShareDismissal =
    'OrotUITests/RecordingExportUITests/testActualAudioShareDismissalCleansTemporaryFilesAndPreservesSource';
  const standardKeyboardSave =
    'OrotUITests/NextVisitReviewUITests/testSaveRemainsAboveTheActualKeyboardWhileEditingTheThirdQuestion';
  const providerSelectionTests = iosTestInventory('provider-selection');
  const speechTests = iosTestInventory('speech');
  // Keep Duo-only cohorts explicit so the exact inventory cannot drift silently.
  assert.equal(duoInventory.length, 43);
  assert.deepEqual(duoInventory, [
    'OrotUITests/TestHostConnectionTests/testHostLaunches',
    'OrotUITests/RootNavigationUITests/testRightRailKeepsAccessibleRootAndContextualNavigation',
    'OrotUITests/RootNavigationUITests/testSettingsKeepsAccountsBackupAndPrivacyOnTheirOwnRoutes',
    homeSummary,
    settingsHome,
    settingsAccounts,
    settingsProvider,
    providerAuthReflow,
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
    'OrotUITests/AppointmentConsentUITests/testManualPageReturnsThroughClassificationAndScheduleToHome',
    manualAppointmentReflow,
    contextualDeparture,
    manualHistoryRecovery,
    manualHistoryReflow,
    duoKeyboardSave,
    fourSidedOcclusion,
    recordingShareDismissal,
    recordsHub,
    healthLibraryReflow,
    healthImportLibrary,
    'OrotUITests/HealthImportDuoUITests/testSyntheticHealthLibraryAndDetailKeepContentBoundariesAtBothTextSizes',
    healthDataSettingsReflow,
    diseaseHypothesesReflow,
    evidenceSourceReflow,
    healthImportReflow,
    healthImportLargeText,
    healthRecordDetailReflow,
    medicationHistoryReflow,
    keyboardUndoReflow,
    syncStatusReflow,
    recordingLiveReflow,
    recordingReviewReflow,
    activeTranscriptionReflow,
    savedRecordingsSelectionSummary,
  ]);
  // Home stays in iPhone fixtures; privacy, feature-entry, manual-appointment,
  // manual-history, records, and Duo-only health-import regressions use the dedicated destination.
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
    activeTranscriptionReflow,
    manualAppointmentReflow,
    manualHistoryRecovery,
    settingsAccounts,
    privacySettingsReflow,
    healthLibraryReflow,
    healthDataSettingsReflow,
    diseaseHypothesesReflow,
    evidenceSourceReflow,
    healthImportLibrary,
    healthImportReflow,
    healthImportLargeText,
    medicationHistoryReflow,
  ]) {
    assert.ok(!iPhoneFixtures.includes(duoOnlyCase));
    assert.ok(!coreTests.includes(duoOnlyCase));
  }
  assert.ok(iPhoneFixtures.includes(standardKeyboardSave));
  assert.ok(iPhoneFixtures.includes(keyboardUndoReflow));
  assert.ok(providerSelectionTests.includes(providerAuthReflow));
  assert.ok(speechTests.includes(savedDraftTranscription));
  assert.ok(!speechTests.includes(activeTranscriptionReflow));
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
