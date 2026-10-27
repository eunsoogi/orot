import {
  iosTestConfig,
  representativeSpeechTests,
  speechJourneyTests,
} from './ios-test-config.mjs';
import { iosFixtureGroups, selectIosFixtureGroup } from './ios-test-fixture-groups.mjs';
import { duoTests } from './duo-test-inventory.mjs';
import { fixtureIsolationTests } from './fixture-isolation-test-phases.mjs';
import { medicalDocumentCoreTests } from './medical-document-test-inventory.mjs';
import { recordingPersistenceTests } from './recording-persistence-test-phases.mjs';
import { statePersistenceTests } from './state-persistence-test-phases.mjs';
import { windowPresentationAnchorTests } from './window-presentation-anchor-test-inventory.mjs';

const coreTests = [
  // Notification privacy, trigger identity, replacement and cold-start delivery remain native obligations.
  'OrotIntegrationTests/AppointmentReminderNotificationTests/testNotificationContentCannotCopyClinicalBridgeFields',
  'OrotIntegrationTests/AppointmentReminderNotificationTests/testZonedRequestUsesANonRepeatingUTCTrigger',
  'OrotIntegrationTests/AppointmentReminderNotificationTests/testFractionalTimestampsNeverRoundDeliveryEarlierThanTheSelectedOffset',
  'OrotIntegrationTests/AppointmentReminderNotificationTests/testPendingReplacementUsesOneRequestAndCancellationRemovesIt',
  'OrotIntegrationTests/AppointmentReminderNotificationTests/testFloatingRequestRetainsCivilTimeIdentityWithoutPinningDeviceZone',
  'OrotIntegrationTests/AppointmentReminderNotificationTests/testColdStartInboxRetainsTheTargetUntilOneConsumerDrainsIt',
  'OrotIntegrationTests/AppointmentReminderNotificationTests/testDismissalAndOtherFeatureNotificationsCannotOpenVisitPreparation',
  'OrotIntegrationTests/AppointmentReminderNotificationTests/testMalformedTimesAndUnsupportedDurationsCannotReachTheOS',
  // The structural observer must retain its object-identity, missing-target, and privacy contracts in CI.
  'OrotIntegrationTests/SymptomAccessorySnapshotTests/testAttachmentPairsObjectsInsteadOfRepeatedNativeIDs',
  'OrotIntegrationTests/SymptomAccessorySnapshotTests/testMissingAndDetachedTargetsRemainExplicit',
  'OrotIntegrationTests/SymptomAccessorySnapshotTests/testSnapshotPreservesFocusAndOmitsTextAndHierarchy',
  'OrotIntegrationTests/ProgressIndicatorIntegrationTests/testAnimationFollowsWindowAndRequestLifetime',
  ...statePersistenceTests,
  ...fixtureIsolationTests,
  ...recordingPersistenceTests,
  ...medicalDocumentCoreTests,
  'OrotIntegrationTests/RecordingMeteringBoundaryTests/testRecorderErrorsHopToTheOwnedQueueAndIgnoreStaleSessions',
  'OrotIntegrationTests/RecordingMeteringBoundaryTests/testNotificationOccurrencePrecedesQueueDeliveryWithoutChangingActiveCaptureProtection',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testHostExecutesHermesOperations',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testTwentyGraphInvocationsAndStreams',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testWorkflowProgressProjectsBufferedRuntimeEvents',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testLargeHealthLibraryUsesDefaultPagesAndStableCursors',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testSourceLinkedLocalQueriesRemoveTheirSyntheticFixtures',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testLongitudinalHealthContextPreservesCoverageAndInvalidatesDeletion',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testComputedPeriodSummaryRestoresAndPurgesDeletedInputs',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testLargeMixedLibraryMeasuresBoundedAiPreparation',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testLargeCalendarClassificationReportsProgressAndCancellation',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testEncryptedSourceEvidenceAndRagRelationships',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testMemoryDeletionKeepsTombstonesAndRemovesSearchEvidence',
  'OrotIntegrationTests/TestOperationBrokerTests/testCommandCompletesExactlyOnce',
  'OrotIntegrationTests/TestOperationBrokerTests/testUnconsumedCommandWaitsForCancellation',
  'OrotIntegrationTests/TestOperationBrokerTests/testCancellationDoesNotWaitForJavascript',
  'OrotIntegrationTests/NavigationLayoutIntegrationTests/testProductionRootTabSymbolsAndLabelsFitTheirUIKitTouchTargets',
  'OrotIntegrationTests/NavigationLayoutIntegrationTests/testContextualDisabledAccessibilityTracksUIKitStateWithoutTabSelection',
  'OrotIntegrationTests/NavigationLayoutIntegrationTests/testRootTabAccessibilityKeepsDisabledAndSelectedTraitsTogether',
  'OrotIntegrationTests/NavigationLayoutIntegrationTests/testBackAndHomeNeverExposeRootTabSelectionToAccessibility',
  'OrotIntegrationTests/NavigationLayoutIntegrationTests/testPrimaryNavigationActionsKeepTheirMinimumNativeTargetSize',
  'OrotIntegrationTests/NavigationLayoutIntegrationTests/testContextualPrimaryActionPreservesButtonIdentityAcrossSaveStateUpdates',
  'OrotIntegrationTests/RecordingExportIntegrationTests/testUtf8TranscriptCopyIsExcludedFromBackupAndRemovedAfterExport',
  'OrotIntegrationTests/RecordingExportIntegrationTests/testAudioCopyPreservesSourceBytesAndSyntheticAuthorizationGuardrails',
  'OrotIntegrationTests/RecordingExportIntegrationTests/testUnverifiedFullScreenPresentationRetainsExportUntilDismissal',
  'OrotIntegrationTests/RecordingExportIntegrationTests/testDefaultTranscriptSharePreservesItsExactWindowRegionUntilDismissal',
  ...windowPresentationAnchorTests,
  'OrotUITests/TestHostConnectionTests/testHostLaunches',
  'OrotUITests/RootNavigationUITests/testEveryRootTabAndRecordingNavigationRemainReachable',
  'OrotUITests/RootNavigationUITests/testContextualNavigationRemainsAboveKeyboardAndHomeDismissesIt',
  'OrotUITests/RootNavigationUITests/testSettingsKeepsAccountsBackupAndPrivacyOnTheirOwnRoutes',
  'OrotUITests/TranscriptEvidenceUITests/testNativeReviewHistoryPlaybackAndDeleteConfirmation',
  'OrotUITests/RecordingExportUITests/testActualAudioShareDismissalCleansTemporaryFilesAndPreservesSource',
];
const providerTests = [
  'OrotIntegrationTests/AppleNativeToolLifecycleTests/testCallbackResultDrainsBeforeFreshGeneration',
  'OrotIntegrationTests/AppleNativeToolLifecycleTests/testCancellationReleasesWaitingCallback',
  'OrotIntegrationTests/AppleNativeToolLifecycleTests/testDrainFailureDoesNotStartFreshGeneration',
  'OrotIntegrationTests/AppleNativeToolLifecycleTests/testSecondCallbackDuringDrainIsRejected',
  'OrotIntegrationTests/AppleNativeToolLifecycleTests/testCancellationDuringDrainReleasesTheNextRequest',
  'OrotIntegrationTests/AppleNativeToolLifecycleTests/testWatchdogReleasesAnOrphanedCallback',
  'OrotIntegrationTests/AppleNativeToolLifecycleTests/testParallelCallbackFailsWithoutPublishingAnotherTool',
  'OrotIntegrationTests/RagWorkflowIntegrationTests/testPublicRetrievalReturnsAnAnswerWithGroundedCitations',
  'OrotIntegrationTests/AppleModelIntegrationTests/testStreamingFailurePreservesKnownNativeDecisions',
  'OrotIntegrationTests/AppleModelIntegrationTests/testMockAvailabilityGenerationStreamingCancellationAndFailures',
  'OrotIntegrationTests/AppleWorkflowIntegrationTests/testMockCalendarClassificationCitedQuestionsAndWorkflowCancellation',
  'OrotIntegrationTests/AppleWorkflowIntegrationTests/testThreeMockCalendarClassificationsAndTwoImportsKeepOneMedicalOccurrence',
  'OrotIntegrationTests/ProviderIntegrationTests/testSyntheticCatalogStreamLimitAndCancellationUseProviderBridge',
  'OrotIntegrationTests/ProviderIntegrationTests/testSyntheticToolDefinitionAndLocalResultRoundTripUseProviderBridge',
  'OrotIntegrationTests/StandardAdapterIntegrationTests/testStandardAdaptersPreserveNativeDispatchSchemasToolsUsageAndCancellation',
  'OrotIntegrationTests/MedicationDoseCursorTests/testCatalogShrinkageAndEmptyVisibilityRetainDeletionScope',
  'OrotIntegrationTests/MedicationDoseCursorTests/testReplayExpansionAndErrorsPreserveCheckpointInvariants',
  'OrotIntegrationTests/HealthIntegrationTests/testAuthorizationScopesAndSyntheticSamplesStayExplicit',
  'OrotIntegrationTests/HealthIntegrationTests/testSyntheticSleepNormalizationAndAnchorResume',
];
// Both protected-item checks require Face ID enrollment; the positive case also opens a match prompt.
const interactiveAuthenticationTests = [
  'OrotIntegrationTests/KeychainAuthenticationIntegrationTests/testKeychainQueryUsesFreshContextAndBlocksProtectedLookupWithoutUi',
  'OrotIntegrationTests/KeychainAuthenticationIntegrationTests/testProtectedKeychainReadUsesPromptedContextAfterBiometricMatch',
];
export const backupTests = [
  'OrotUITests/BackupPersistenceUITests/testKeyAndMemoryTombstonesSurviveProcessRestart',
  'OrotUITests/BackupPersistenceUITests/testLegacyRecordingRetainsStrictSourceProtectionGate',
  'OrotUITests/BackupPersistenceUITests/testFailedKeyMigrationRollsBackAndRecoversAfterRestart',
  'OrotUITests/BackupPersistenceUITests/testSeedAppContainerSnapshot',
  'OrotUITests/BackupPersistenceUITests/testRecoverAppContainerSnapshot',
];
export const healthImportTests = [
  'OrotUITests/HealthImportUITests/testSyntheticBloodPressurePersistsAndReplaysAfterProcessRestart',
  'OrotUITests/HealthImportUITests/testCommonObservationsUseEncryptedStorageAndIdempotentReplay',
  'OrotUITests/UnifiedImportUITests/testSyntheticConsentMeasurementsAndExplicitCalendarConfirmation',
  'OrotUITests/UnifiedImportUITests/testCancellationPreventsQueriesAndPersistenceBeforeSameSelectionRetry',
  // Real document-picker journeys run in both the Debug import suite and Release fixture suite.
  'OrotUITests/MedicalDocumentImportJourneyUITests/testTextBasedPdfCanBeReviewedSavedAndOpenedWithProvenance',
  'OrotUITests/MedicalDocumentImportJourneyUITests/testDuplicateImportKeepsSavedOriginalAndProvenance',
  'OrotUITests/MedicalDocumentImportJourneyUITests/testScannedPdfIsRejectedWithoutSavingSource',
];
export const localModelTests = [
  'OrotIntegrationTests/LocalModelIntegrationTests/testFreshE5RetrievalMeasurementsAndInferenceCancellation',
  'OrotIntegrationTests/LocalModelIntegrationTests/testE5IndexAndKoreanRetrievalSurviveProcessRestart',
  'OrotIntegrationTests/LocalModelIntegrationTests/testFreshHybridSearchPreservesFiltersLocatorsAndTemporaryTableCleanup',
  'OrotIntegrationTests/LocalModelIntegrationTests/testHybridRetainedVectorSurvivesProcessRestartWithoutReindexing',
];
export const microphoneTests = [
  'OrotUITests/MicrophoneMeteringUITests/testMeteringEventsPauseResumeAndExplicitCleanup',
  'OrotUITests/MicrophoneMeteringUITests/testWallClockDeadlineEndsCaptureAndCleansItsArtifact',
];
export const providerSelectionTests = [
  'OrotUITests/ProviderSelectionUITests/testAuthSessionCancellationRouteExitRetryAndCallbackKeepSelectionExplicit',
  'OrotUITests/ProviderSelectionUITests/testExplicitSelectionAndKeychainRestoreNeverChooseAnAutomaticFallback',
  'OrotUITests/ProviderSelectionUITests/testSignOutCancelsTheOpenResponseAndSurvivesProcessRestartBeforeRelogin',
];
export const fixtureTests = [
  'OrotUITests/SummaryAndLiteratureUITests/testSavedSummaryRestoresAfterRelaunchAndHistoryReadRecoversAcrossAppearances',
  'OrotUITests/SummaryAndLiteratureUITests/testLiteratureConsentSearchRecoveryAndCancelledReadAcrossAppearances',
  'OrotUITests/AiFeatureNavigationUITests/testRootFeatureRoutesKeepTheirClearanceAndRecoverWhenNoProviderIsSelected',
  'OrotUITests/AiFeatureNavigationUITests/testAiScreensAndSeparateHistoriesAcrossAppearanceChanges',
  'OrotUITests/AiFeatureNavigationUITests/testEvidenceKindsAndRecoveryAcrossAppearances',
  'OrotUITests/WindowGeometryUITests/testIPhoneGeometryEventsMatchUIKitAndRetainQuestionDraftAcrossSourceNavigation',
  'OrotUITests/OrientationPresentationAnchorUITests/testLandscapeTransitionRetainsQuestionDraftAndSourceRoute',
  'OrotUITests/SafeAreaNavigationUITests/testSystemInsetsAcrossHomeHealthImportRecordingAndBloodPressureLibrary',
  'OrotUITests/RootNavigationUITests/testAiFeatureSafeAreaActionsAndCancelledThenCompletedEdgeBack',
  'OrotUITests/RecordingLibraryUITests/testSavedMetadataAndTranscriptReviewRemainReadableAcrossLiveAppearanceChanges',
  'OrotUITests/RecordingLibraryUITests/testRecordingConsentAndSeparateLibraryAcrossAppearanceChanges',
  'OrotUITests/RecordingLibraryUITests/testActiveAndPausedRecordingControlsAcrossAppearanceChanges',
  'OrotUITests/RecordingLibraryUITests/testLargeTextKeepsTranscriptSaveReachableWithKeyboardVisible',
  'OrotUITests/RecordingLibraryUITests/testSavedRecordingRowsRemainReadableInA320PointViewport',
  'OrotUITests/RecordingPlaybackUITests/testSavedAudioPlaybackStopsCompletesAndReopensBeforeMissingFileRecovery',
  'OrotUITests/RecordingPlaybackUITests/testPlaybackRecoversAfterTheSimulatedOutputRouteLoss',
  'OrotUITests/UnifiedImportUITests/testProviderSelectionUsesTheRealRecordsRouteAcrossAppearanceChangesBeforeImport',
  'OrotUITests/NextVisitReviewUITests/testSaveRemainsAboveTheActualKeyboardWhileEditingTheThirdQuestion',
  'OrotUITests/RootNavigationUITests/testLargeTextKeepsRootTabsAndRecordingActionsReachable',
  'OrotUITests/NextVisitReviewUITests/testCitedReviewSaveCancelAndReloadRetainTheSavedQuestionsAcrossAppearanceChanges',
  'OrotUITests/KeyboardSafeAreaUITests/testKoreanPrimaryActionRemainsReachableWithLargeTextAndKeyboardOpen',
  'OrotUITests/KeyboardSafeAreaUITests/testConversationOutputComposerAndSwipeUndoAcrossAppearances',
  'OrotUITests/KeyboardSafeAreaUITests/testConversationLongTitlesAndFullSwipeAcrossTextSizes',
  'OrotUITests/PagedHealthRecordsUITests/testSecondPageValueAndShortThenCompleteBackSwipe',
  'OrotUITests/HealthImportUITests/testDisplayOnlyBloodPressureCompletionCounts',
  'OrotUITests/AppointmentConsentUITests/testDisclosureBlocksProviderUntilApprovalAndNeverSavesFailedClassification',
  'OrotUITests/AppointmentConsentUITests/testDisclosureCollapsedAndExpandedAcrossAppearances',
  'OrotUITests/AppointmentConsentUITests/testManualPageReturnsThroughClassificationAndScheduleToHome',
  'OrotUITests/VisitQuestionConsentUITests/testDeclinedRemoteConsentStopsSendsAndCitedQuestionsRemainReviewable',
  'OrotUITests/StorageMigrationUITests/testLegacyEncryptedSchemaReopensThroughAppointmentsAfterProcessRestart',
  'OrotUITests/AppointmentsUITests/testCreationEditingAndCancellationSurviveProcessRestarts',
  'OrotUITests/AppointmentReminderJourneyUITests/testLocalReplacementCancellationAndActualRunningAndColdNotificationTaps',
  'OrotUITests/AppointmentReminderJourneyUITests/testReminderControlsAndPreparationAcrossAppearancesAndLargeText',
  'OrotUITests/SymptomJournalUITests/testCreationEditingFilteringAndResolutionSurviveRelaunch',
  'OrotUITests/CalendarSelectionUITests/testOnlyTheSelectedSyntheticEventIsConfirmedFromTheScheduleTab',
  'OrotUITests/ScheduleCalendarUITests/testSelectedAppointmentSurvivesDarkLandscapeReflowAndConfirmation',
  'OrotUITests/ScheduleCalendarUITests/testLargeTextKeepsScheduleConfirmationReachable',
  'OrotUITests/ManualHistoryUITests/testKnownDateProvenanceAndCorrectionSurviveProcessRestart',
  'OrotUITests/ManualHistoryUITests/testUnknownDateAndConfirmedLineageDeletionSurviveProcessRestart',
  'OrotUITests/ManualHistoryUITests/testUnsavedDraftRequiresConfirmationBeforeLeavingManualHistory',
  'OrotUITests/MedicalDocumentImportJourneyUITests/testTextBasedPdfCanBeReviewedSavedAndOpenedWithProvenance',
  'OrotUITests/MedicalDocumentImportJourneyUITests/testDuplicateImportKeepsSavedOriginalAndProvenance',
  'OrotUITests/MedicalDocumentImportJourneyUITests/testScannedPdfIsRejectedWithoutSavingSource',
];

/** Execution and result verification consume the same exact list, so unselected tests cannot silently disappear. */
export function iosTestInventory(profile, suite = 'all') {
  const spec = iosTestConfig(profile);
  if (
    (![
      'all',
      'integration',
      'ui',
      'authentication',
      'preparation',
      'journey',
      'isolation',
      'recording-persistence',
      'state-persistence',
      'shared-persistence',
    ].includes(suite) &&
      !(profile === 'fixtures' && Object.hasOwn(iosFixtureGroups, suite))) ||
    (!['speech', 'core', 'fixtures'].includes(profile) && suite !== 'all') ||
    (suite === 'preparation' && profile !== 'speech') ||
    (suite === 'journey' && profile !== 'speech') ||
    (suite === 'authentication' && profile !== 'core') ||
    (suite === 'isolation' && profile !== 'core') ||
    (suite === 'recording-persistence' && profile !== 'core') ||
    (suite === 'state-persistence' && profile !== 'core') ||
    (suite === 'shared-persistence' && profile !== 'core') ||
    (profile === 'fixtures' && suite !== 'all' && !Object.hasOwn(iosFixtureGroups, suite))
  )
    throw new Error('Unsupported integration test suite selection');
  // Do not let an unknown Release profile fall through to the provider inventory.
  if (profile === 'duo') return duoTests.slice();
  if (suite === 'journey') return speechJourneyTests.slice();
  if (suite === 'authentication') return interactiveAuthenticationTests.slice();
  if (suite === 'isolation') return fixtureIsolationTests.slice();
  if (suite === 'recording-persistence') return recordingPersistenceTests.slice();
  if (suite === 'state-persistence') return statePersistenceTests.slice();
  if (suite === 'shared-persistence')
    return [...statePersistenceTests, ...recordingPersistenceTests];
  if (suite === 'preparation')
    return [
      'OrotIntegrationTests/SpeechAssetPreparationTests/testSelectedKoreanAssetsInstallWithoutRecognizingAnyFixture',
    ];
  const inventory = [
    ...(profile === 'speech'
      ? representativeSpeechTests
      : profile === 'core'
        ? coreTests
        : profile === 'backup'
          ? backupTests
          : profile === 'local-model'
            ? localModelTests
            : profile === 'fixtures'
              ? fixtureTests
              : profile === 'microphone'
                ? microphoneTests
                : profile === 'health-import'
                  ? healthImportTests
                  : profile === 'provider-selection'
                    ? providerSelectionTests
                    : providerTests),
  ];
  if (profile === 'fixtures') return selectIosFixtureGroup(inventory, suite);
  // Core and Speech integration and UI retain distinct result boundaries in their shared hosted cohort.
  // Both subsets remain mandatory and their union is the original complete inventory.
  if (suite === 'all') return inventory;
  const target = suite === 'integration' ? spec.integrationTarget : spec.uiTarget;
  return inventory.filter(
    (identifier) =>
      identifier.startsWith(target + '/') &&
      !fixtureIsolationTests.includes(identifier) &&
      !recordingPersistenceTests.includes(identifier) &&
      !statePersistenceTests.includes(identifier) &&
      !(profile === 'speech' && suite === 'integration' && speechJourneyTests.includes(identifier)),
  );
}
