import { iosTestConfig, representativeSpeechTests } from './ios-test-config.mjs';

const coreTests = [
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
  'OrotIntegrationTests/AppleModelIntegrationTests/testAvailabilityAndSupportedGenerationKeepRuntimeLimitationsExplicit',
  'OrotIntegrationTests/ProviderIntegrationTests/testSyntheticCatalogStreamLimitAndCancellationUseNativeBridge',
  'OrotIntegrationTests/ProviderIntegrationTests/testSyntheticToolDefinitionAndLocalResultRoundTripUseNativeBridge',
  'OrotIntegrationTests/HealthIntegrationTests/testAuthorizationScopesAndSyntheticSamplesStayExplicit',
  'OrotIntegrationTests/HealthIntegrationTests/testSyntheticSleepNormalizationAndAnchorResume',
];

/** Execution and result verification consume the same exact list, so unselected tests cannot silently disappear. */
export function iosTestInventory(profile, suite = 'all') {
  const spec = iosTestConfig(profile);
  if (!['all', 'native', 'ui'].includes(suite) || (profile !== 'speech' && suite !== 'all'))
    throw new Error('Unsupported native test suite selection');
  const inventory = [
    ...(profile === 'speech'
      ? representativeSpeechTests
      : profile === 'core'
        ? coreTests
        : providerTests),
  ];
  // Cold Speech and XCUI framework initialization run on distinct hosted machines.
  // Both subsets remain mandatory and their union is the original complete inventory.
  if (suite === 'all') return inventory;
  const target = suite === 'native' ? spec.integrationTarget : spec.uiTarget;
  return inventory.filter((identifier) => identifier.startsWith(target + '/'));
}
