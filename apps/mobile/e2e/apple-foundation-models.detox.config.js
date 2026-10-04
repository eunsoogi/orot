/** @type {Detox.DetoxConfig} */
const derivedDataPath =
  process.env.OROT_APPLE_FOUNDATION_MODELS_DERIVED_DATA_PATH ||
  'ios/build-apple-foundation-models';
const simulatorId = process.env.OROT_APPLE_FOUNDATION_MODELS_SIMULATOR_UDID;

if (!simulatorId) {
  throw new Error(
    'Set OROT_APPLE_FOUNDATION_MODELS_SIMULATOR_UDID to the dedicated Simulator UDID.',
  );
}

if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The Apple Foundation Models DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}

module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/apple-foundation-models.jest.config.js',
    },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.apple-foundation-models': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Release-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination "platform=iOS Simulator,id=$OROT_APPLE_FOUNDATION_MODELS_SIMULATOR_UDID" -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/appleFoundationModelsProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { id: simulatorId },
    },
  },
  configurations: {
    'ios.sim.release.apple-foundation-models': {
      device: 'simulator',
      app: 'ios.apple-foundation-models',
    },
  },
};
