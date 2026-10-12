// Native test products are separate when configuration, flags or runtime contracts differ.
export function iosTestConfig(profile) {
  const common = {
    scheme: 'OrotTests',
    entry: 'e2e/testEntry.tsx',
    sdk: '27.0',
    xcode: '27.0',
    architecture: 'arm64',
    integrationTarget: 'OrotIntegrationTests',
    uiTarget: 'OrotUITests',
    appName: 'Orot.app',
    compilerFlags: '$(inherited) -DOROT_TESTS -DOROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST',
    preprocessorFlags: '$(inherited) OROT_TESTS=1',
    testability: 'YES',
  };
  if (profile === 'core') {
    return {
      ...common,
      profile,
      configuration: 'Release',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
      runtimeBuild: null,
      device: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
    };
  }
  if (profile === 'speech') {
    return {
      ...common,
      profile,
      configuration: 'Release',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-2',
      runtimeBuild: '23C54',
      device: 'com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation',
    };
  }
  if (profile === 'provider-data') {
    return {
      ...common,
      profile,
      configuration: 'Debug',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
      runtimeBuild: null,
      device: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
    };
  }
  throw new Error('Unknown native test profile: ' + profile);
}

export function iosTestBuildSpec(profile) {
  const execution = iosTestConfig(profile);
  // Native products use one generic entry and identical test-only flags. Release
  // UI and Speech can share that exact product; Debug dependencies remain separate.
  const build = Object.fromEntries(
    Object.entries(execution).filter(
      ([name]) => !['profile', 'runtime', 'runtimeBuild', 'device'].includes(name),
    ),
  );
  return {
    ...build,
    productProfile: execution.configuration === 'Release' ? 'ios-test-release' : 'ios-test-debug',
    signing: { allowed: 'YES', identity: '-', team: 'OROTSIM000' },
    compatibleExecutions:
      execution.configuration === 'Release' ? ['core', 'speech'] : ['provider-data'],
  };
}

export const representativeSpeechTests = [
  'OrotIntegrationTests/SpeechIntegrationTests/testMedicationFixture',
  'OrotIntegrationTests/SpeechIntegrationTests/testNumberFixture',
  'OrotIntegrationTests/SpeechIntegrationTests/testNegationFixture',
  'OrotIntegrationTests/SpeechIntegrationTests/testInvalidLanguageFailsBeforeRequestingNativeServices',
  'OrotIntegrationTests/SpeechIntegrationTests/testMissingAudioFailsBeforeRequestingNativeServices',
  'OrotIntegrationTests/SpeechCancellationTests/testProductionDeadlineCancellationPropagatesAndCancelsWorker',
  'OrotUITests/TestHostConnectionTests/testHostLaunches',
  'OrotUITests/SpeechJourneyUITests/testTranscriptionReachesSavedRecordingAndSurvivesRelaunch',
  'OrotUITests/RecordingExportUITests/testShareCancellationCleansTemporaryFilesAndPreservesSourceAfterRestart',
];
