import { iosTestConfig, representativeSpeechTests } from './ios-test-config.mjs';

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
  'OrotIntegrationTests/NavigationLayoutIntegrationTests/testProductionRootTabSymbolsAndLabelsFitTheirNativeTouchTargets',
  'OrotIntegrationTests/RecordingExportIntegrationTests/testUtf8TranscriptCopyIsExcludedFromBackupAndRemovedAfterExport',
  'OrotIntegrationTests/RecordingExportIntegrationTests/testAudioCopyPreservesSourceBytesAndSyntheticAuthorizationGuardrails',
  'OrotUITests/TestHostConnectionTests/testHostLaunches',
  'OrotUITests/RootNavigationUITests/testEveryRootTabAndNativeRecordingNavigationRemainReachable',
  'OrotUITests/RootNavigationUITests/testSettingsKeepsAccountsBackupAndPrivacyOnTheirOwnRoutes',
  'OrotUITests/PersistenceUITests/testEncryptedSourceAndEvidenceSurviveProcessRestart',
  'OrotUITests/PersistenceUITests/testRemovedMemoryAndHybridEvidenceDoNotReturnAfterRelaunch',
  'OrotUITests/PersistenceUITests/testUtf8CheckpointResumesWithoutRepeatingCompletedNode',
  'OrotUITests/TranscriptEvidenceUITests/testReviewCorrectionHistoryPlaybackAndDeletionSurviveRelaunch',
];
const providerTests = [
  'OrotIntegrationTests/RagWorkflowIntegrationTests/testPublicRetrievalReturnsAnAnswerWithGroundedCitations',
  'OrotIntegrationTests/AppleModelIntegrationTests/testAvailabilityAndSupportedGenerationKeepRuntimeLimitationsExplicit',
  'OrotIntegrationTests/AppleWorkflowIntegrationTests/testActualCalendarClassificationCitedQuestionsAndWorkflowCancellation',
  'OrotIntegrationTests/ProviderIntegrationTests/testSyntheticCatalogStreamLimitAndCancellationUseNativeBridge',
  'OrotIntegrationTests/ProviderIntegrationTests/testSyntheticToolDefinitionAndLocalResultRoundTripUseNativeBridge',
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
  'OrotIntegrationTests/LocalModelIntegrationTests/testFreshE5RetrievalMeasurementsAndNativeCancellation',
  'OrotIntegrationTests/LocalModelIntegrationTests/testE5IndexAndKoreanRetrievalSurviveProcessRestart',
  'OrotIntegrationTests/LocalModelIntegrationTests/testFreshHybridSearchPreservesFiltersLocatorsAndTemporaryTableCleanup',
  'OrotIntegrationTests/LocalModelIntegrationTests/testHybridRetainedVectorSurvivesProcessRestartWithoutReindexing',
];
export const microphoneTests = [
  'OrotUITests/MicrophoneMeteringUITests/testNativeEventsPauseResumeAndExplicitCleanup',
  'OrotUITests/MicrophoneMeteringUITests/testWallClockDeadlineEndsCaptureAndCleansItsArtifact',
];
export const fixtureTests = [
  'OrotUITests/PagedHealthRecordsUITests/testSecondPageValueAndShortThenCompleteNativeBackSwipe',
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
    !['all', 'native', 'ui', 'preparation'].includes(suite) ||
    (profile !== 'speech' && suite !== 'all')
  )
    throw new Error('Unsupported native test suite selection');
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
                  : providerTests),
  ];
  // Cold Speech and XCUI framework initialization run on distinct hosted machines.
  // Both subsets remain mandatory and their union is the original complete inventory.
  if (suite === 'all') return inventory;
  const target = suite === 'native' ? spec.integrationTarget : spec.uiTarget;
  return inventory.filter((identifier) => identifier.startsWith(target + '/'));
}
