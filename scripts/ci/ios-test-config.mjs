// iOS test products are separate when configuration, flags or runtime contracts differ.
// The hosted xcode-27 label can change its default app between image releases; select one named bundle.
export const iosXcodeVersion = '27.1';
export const iosSimulatorSdk = '27.1';
export const iosXcodeDeveloperDirectory = '/Applications/Xcode_27.1.app/Contents/Developer';

export function iosTestConfig(profile) {
  const common = {
    scheme: 'OrotTests',
    entry: 'e2e/testEntry.tsx',
    sdk: iosSimulatorSdk,
    xcode: iosXcodeVersion,
    architecture: 'arm64',
    integrationTarget: 'OrotIntegrationTests',
    uiTarget: 'OrotUITests',
    appName: 'Orot.app',
    compilerFlags: '$(inherited) -DOROT_TESTS -DOROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST',
    preprocessorFlags: '$(inherited) OROT_TESTS=1',
    testability: 'YES',
  };
  if (profile === 'duo') {
    // Duo requires a newer runtime than ordinary iPhones, not a newer build SDK.
    // Keep this opt-in destination out of the existing hosted cohorts.
    return {
      ...common,
      profile,
      configuration: 'Release',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1',
      runtimeBuild: null,
      device: 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo',
    };
  }
  if (['core', 'backup', 'fixtures', 'local-model'].includes(profile)) {
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
  if (['provider-data', 'health-import', 'microphone', 'provider-selection'].includes(profile)) {
    return {
      ...common,
      profile,
      configuration: 'Debug',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
      runtimeBuild: null,
      device: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
    };
  }
  throw new Error('Unknown integration test profile: ' + profile);
}

export function iosTestBuildSpec(profile) {
  const execution = iosTestConfig(profile);
  // iOS products use one generic entry and identical test-only flags. Release
  // UI and Speech can share that exact product; Debug dependencies remain separate.
  const build = Object.fromEntries(
    Object.entries(execution).filter(
      ([name]) => !['profile', 'runtime', 'runtimeBuild', 'device'].includes(name),
    ),
  );
  return {
    ...build,
    // An opt-in Duo product must not change existing artifact compatibility or hosted scheduling.
    productProfile:
      profile === 'duo'
        ? 'ios-test-duo'
        : execution.configuration === 'Release'
          ? 'ios-test-release'
          : 'ios-test-debug',
    signing: { allowed: 'YES', identity: '-', team: 'OROTSIM000' },
    compatibleExecutions:
      profile === 'duo'
        ? ['duo']
        : execution.configuration === 'Release'
          ? ['core', 'speech', 'backup', 'fixtures', 'local-model']
          : ['provider-data', 'health-import', 'microphone', 'provider-selection'],
  };
}

export const speechJourneyTests = [
  'OrotUITests/AutomaticTranscriptionUITests/testScreenStopReachesSavedDraft',
  'OrotIntegrationTests/AutomaticSpeechPersistenceTests/testSavedSpeechFieldsSurviveNewProcessWithoutRecognition',
];

export const representativeSpeechTests = [
  'OrotIntegrationTests/SpeechIntegrationTests/testMedicationFixture',
  'OrotIntegrationTests/SpeechIntegrationTests/testNumberFixture',
  'OrotIntegrationTests/SpeechIntegrationTests/testNegationFixture',
  'OrotIntegrationTests/SpeechIntegrationTests/testInvalidLanguageFailsBeforeRequestingSpeechServices',
  'OrotIntegrationTests/SpeechIntegrationTests/testMissingAudioFailsBeforeRequestingSpeechServices',
  'OrotIntegrationTests/SpeechCancellationTests/testProductionDeadlineCancellationPropagatesAndCancelsWorker',
  ...speechJourneyTests,
];
