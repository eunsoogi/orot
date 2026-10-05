/** @type {Detox.DetoxConfig} */
// Isolate this alternate bundle so another probe's cached app cannot run in its place.
const derivedDataPath =
  process.env.OROT_SPEECH_TRANSCRIPTION_DERIVED_DATA_PATH ||
  'ios/build-speech-transcription';
const simulatorId = process.env.OROT_SPEECH_TRANSCRIPTION_SIMULATOR_UDID;

if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The speech transcription DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/transcription.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.speech-transcription': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Release-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -derivedDataPath ' +
        derivedDataPath +
        " CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements OTHER_SWIFT_FLAGS='$(inherited) -DOROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST' ENTRY_FILE=e2e/transcriptionProbeEntry.tsx",
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: simulatorId ? { id: simulatorId } : { type: 'iPhone 18 Pro' },
    },
  },
  configurations: {
    'ios.sim.release.transcription': {
      device: 'simulator',
      app: 'ios.speech-transcription',
    },
  },
};
