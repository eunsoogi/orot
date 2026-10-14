import { iosTestConfig, representativeSpeechTests } from './ios-test-config.mjs';
import { iosFixtureGroups, selectIosFixtureGroup } from './ios-test-fixture-groups.mjs';

const coreTests = [
  'OrotIntegrationTests/RecordingMeteringBoundaryTests/testNotificationOccurrencePrecedesQueueDeliveryWithoutChangingActiveCaptureProtection',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testHostExecutesHermesOperations',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testTwentyGraphInvocationsAndStreams',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testSourceLinkedLocalQueriesRemoveTheirSyntheticFixtures',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testEncryptedSourceEvidenceAndRagRelationships',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testMemoryDeletionKeepsTombstonesAndRemovesSearchEvidence',
  'OrotIntegrationTests/TestOperationBrokerTests/testCommandCompletesExactlyOnce',
  'OrotIntegrationTests/TestOperationBrokerTests/testUnconsumedCommandTimesOut',
  'OrotIntegrationTests/TestOperationBrokerTests/testCancellationDoesNotWaitForJavascript',
  'OrotIntegrationTests/NavigationLayoutIntegrationTests/testProductionRootTabSymbolsAndLabelsFitTheirUIKitTouchTargets',
  'OrotIntegrationTests/NavigationLayoutIntegrationTests/testDisabledAccessibilityTracksUIKitStateAndPreservesSelectionAcrossUpdates',
  'OrotIntegrationTests/RecordingExportIntegrationTests/testUtf8TranscriptCopyIsExcludedFromBackupAndRemovedAfterExport',
  'OrotIntegrationTests/RecordingExportIntegrationTests/testAudioCopyPreservesSourceBytesAndSyntheticAuthorizationGuardrails',
  'OrotUITests/TestHostConnectionTests/testHostLaunches',
  'OrotUITests/RootNavigationUITests/testEveryRootTabAndRecordingNavigationRemainReachable',
  'OrotUITests/RootNavigationUITests/testSettingsKeepsAccountsBackupAndPrivacyOnTheirOwnRoutes',
  'OrotUITests/PersistenceUITests/testRemovedMemoryAndHybridEvidenceDoNotReturnAfterRelaunch',
  'OrotUITests/PersistenceUITests/testUtf8CheckpointResumesWithoutRepeatingCompletedNode',
  'OrotUITests/TranscriptEvidenceUITests/testReviewCorrectionHistoryPlaybackAndDeletionSurviveRelaunch',
];
const providerTests = [
  'OrotIntegrationTests/RagWorkflowIntegrationTests/testPublicRetrievalReturnsAnAnswerWithGroundedCitations',
  'OrotIntegrationTests/AppleModelIntegrationTests/testMockAvailabilityGenerationStreamingCancellationAndFailures',
  'OrotIntegrationTests/AppleWorkflowIntegrationTests/testMockCalendarClassificationCitedQuestionsAndWorkflowCancellation',
  'OrotIntegrationTests/AppleWorkflowIntegrationTests/testThreeMockCalendarClassificationsAndTwoImportsKeepOneMedicalOccurrence',
  'OrotIntegrationTests/ProviderIntegrationTests/testSyntheticCatalogStreamLimitAndCancellationUseProviderBridge',
  'OrotIntegrationTests/ProviderIntegrationTests/testSyntheticToolDefinitionAndLocalResultRoundTripUseProviderBridge',
  'OrotIntegrationTests/HealthIntegrationTests/testAuthorizationScopesAndSyntheticSamplesStayExplicit',
  'OrotIntegrationTests/HealthIntegrationTests/testSyntheticSleepNormalizationAndAnchorResume',
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
  // Creation must begin with a fresh app and Keychain, while its in-case process restart retains them.
  'OrotUITests/PersistenceUITests/testEncryptedSourceAndEvidenceSurviveProcessRestart',
  'OrotUITests/AiFeatureNavigationUITests/testRootFeatureRoutesKeepTheirClearanceAndRecoverWhenNoProviderIsSelected',
  'OrotUITests/SafeAreaNavigationUITests/testSystemInsetsAcrossHomeHealthImportRecordingAndBloodPressureLibrary',
  'OrotUITests/RootNavigationUITests/testAiFeatureSafeAreaActionsAndCancelledThenCompletedEdgeBack',
  'OrotUITests/RecordingLibraryUITests/testSavedMetadataAndTranscriptReviewRemainReadableAcrossLiveAppearanceChanges',
  'OrotUITests/RecordingLibraryUITests/testSelectedRecordingAndCorrectionHistoryRemainReachableWithLargeText',
  'OrotUITests/RecordingLibraryUITests/testSavedRecordingRowsAndDraftRemainReadableInA320PointViewport',
  'OrotUITests/RecordingPlaybackUITests/testSavedAudioPlaybackStopsCompletesAndReopensBeforeMissingFileRecovery',
  'OrotUITests/RecordingPlaybackUITests/testPlaybackRecoversAfterTheSimulatedOutputRouteLoss',
  'OrotUITests/UnifiedImportUITests/testProviderSelectionUsesTheRealRecordsRouteAcrossAppearanceChangesBeforeImport',
  'OrotUITests/NextVisitReviewUITests/testSaveRemainsAboveTheActualKeyboardWhileEditingTheThirdQuestion',
  'OrotUITests/RootNavigationUITests/testLargeTextKeepsRootTabsAndRecordingActionsReachable',
  'OrotUITests/NextVisitReviewUITests/testCitedReviewSaveCancelAndReloadRetainTheSavedQuestionsAcrossAppearanceChanges',
  'OrotUITests/KeyboardSafeAreaUITests/testKoreanPrimaryActionRemainsReachableWithLargeTextAndKeyboardOpen',
  'OrotUITests/PagedHealthRecordsUITests/testSecondPageValueAndShortThenCompleteBackSwipe',
  'OrotUITests/HealthImportUITests/testDisplayOnlyBloodPressureCompletionCounts',
  'OrotUITests/AppointmentConsentUITests/testDisclosureBlocksProviderUntilApprovalAndNeverSavesFailedClassification',
  'OrotUITests/AppointmentConsentUITests/testManualPageReturnsThroughClassificationAndScheduleToHome',
  'OrotUITests/VisitQuestionConsentUITests/testDeclinedRemoteConsentStopsSendsAndCitedQuestionsRemainReviewable',
  'OrotUITests/StorageMigrationUITests/testLegacyEncryptedSchemaReopensThroughAppointmentsAfterProcessRestart',
  'OrotUITests/AppointmentsUITests/testCreationEditingAndCancellationSurviveProcessRestarts',
  'OrotUITests/CalendarSelectionUITests/testOnlyTheSelectedSyntheticEventIsConfirmedFromTheScheduleTab',
];

/** Execution and result verification consume the same exact list, so unselected tests cannot silently disappear. */
export function iosTestInventory(profile, suite = 'all') {
  const spec = iosTestConfig(profile);
  if (
    (!['all', 'integration', 'ui', 'preparation'].includes(suite) &&
      !(profile === 'fixtures' && Object.hasOwn(iosFixtureGroups, suite))) ||
    (!['speech', 'core', 'fixtures'].includes(profile) && suite !== 'all') ||
    (suite === 'preparation' && profile !== 'speech') ||
    (profile === 'fixtures' && suite !== 'all' && !Object.hasOwn(iosFixtureGroups, suite))
  )
    throw new Error('Unsupported integration test suite selection');
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
  return inventory.filter((identifier) => identifier.startsWith(target + '/'));
}
