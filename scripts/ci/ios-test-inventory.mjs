import { iosTestConfig, representativeSpeechTests } from './ios-test-config.mjs';

const coreTests = [
  'OrotIntegrationTests/HermesDomainIntegrationTests/testHostExecutesHermesOperations',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testTwentyGraphInvocationsAndStreams',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testEncryptedSourceEvidenceAndRagRelationships',
  'OrotIntegrationTests/HermesDomainIntegrationTests/testMemoryDeletionKeepsTombstonesAndRemovesSearchEvidence',
  'OrotIntegrationTests/TestOperationBrokerTests/testCommandCompletesExactlyOnce',
  'OrotIntegrationTests/TestOperationBrokerTests/testUnconsumedCommandTimesOut',
  'OrotIntegrationTests/TestOperationBrokerTests/testCancellationDoesNotWaitForJavascript',
  'OrotUITests/TestHostConnectionTests/testHostLaunches',
  'OrotUITests/PersistenceUITests/testEncryptedSourceAndEvidenceSurviveProcessRestart',
  'OrotUITests/PersistenceUITests/testRemovedMemoryAndHybridEvidenceDoNotReturnAfterRelaunch',
  'OrotUITests/PersistenceUITests/testUtf8CheckpointResumesWithoutRepeatingCompletedNode',
  'OrotUITests/TranscriptEvidenceUITests/testReviewCorrectionHistoryPlaybackAndDeletionSurviveRelaunch',
];
const providerTests = [
  'OrotIntegrationTests/HealthIntegrationTests/testAuthorizationScopesAndSyntheticSamplesStayExplicit',
  'OrotIntegrationTests/HealthIntegrationTests/testSyntheticSleepNormalizationAndAnchorResume',
];

/** Execution and result verification consume the same exact list, so unselected tests cannot silently disappear. */
export function iosTestInventory(profile) {
  iosTestConfig(profile);
  return [
    ...(profile === 'speech'
      ? representativeSpeechTests
      : profile === 'core'
        ? coreTests
        : providerTests),
  ];
}
