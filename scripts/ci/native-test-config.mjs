// Native test products are separate when configuration, flags or runtime contracts differ.
export function nativeTestConfig(profile) {
  const common = {
    scheme: 'OrotNativeTests',
    entry: 'e2e/nativeTestEntry.tsx',
    sdk: '27.0',
    xcode: '27.0',
    architecture: 'arm64',
    nativeTarget: 'OrotNativeIntegrationTests',
    uiTarget: 'OrotUITests',
    appName: 'Orot.app',
    compilerFlags: '$(inherited) -DOROT_NATIVE_TESTS -DOROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST',
    preprocessorFlags: '$(inherited) OROT_NATIVE_TESTS=1',
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

export function nativeBuildSpec(profile) {
  const execution = nativeTestConfig(profile);
  // Native products use one generic entry and identical test-only flags. Release
  // UI and Speech can share that exact product; Debug dependencies remain separate.
  const build = Object.fromEntries(
    Object.entries(execution).filter(
      ([name]) => !['profile', 'runtime', 'runtimeBuild', 'device'].includes(name),
    ),
  );
  return {
    ...build,
    productProfile: execution.configuration === 'Release' ? 'native-release' : 'native-debug',
    signing: { allowed: 'YES', identity: '-', team: 'OROTSIM000' },
    compatibleExecutions:
      execution.configuration === 'Release' ? ['core', 'speech'] : ['provider-data'],
  };
}

export const representativeSpeechTests = [
  'OrotNativeIntegrationTests/SpeechIntegrationTests/testMedicationFixture',
  'OrotNativeIntegrationTests/SpeechIntegrationTests/testNumberFixture',
  'OrotNativeIntegrationTests/SpeechIntegrationTests/testNegationFixture',
  'OrotNativeIntegrationTests/SpeechIntegrationTests/testInvalidLanguageFailsBeforeRequestingNativeServices',
  'OrotNativeIntegrationTests/SpeechIntegrationTests/testMissingAudioFailsBeforeRequestingNativeServices',
  'OrotNativeIntegrationTests/SpeechCancellationTests/testProductionDeadlineCancellationPropagatesAndCancelsWorker',
  'OrotUITests/NativeTestConnectionTests/testNativeTestHostLaunches',
  'OrotUITests/SpeechJourneyUITests/testNativeTranscriptionReachesSavedRecordingAndSurvivesRelaunch',
];
