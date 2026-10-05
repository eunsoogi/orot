/** @type {Detox.DetoxConfig} */
const derivedDataPath =
  process.env.OROT_PROVIDER_SELECTION_DERIVED_DATA_PATH ||
  'ios/build-provider-selection';
const simulatorId = process.env.OROT_PROVIDER_SELECTION_SIMULATOR_UDID;

if (!simulatorId) {
  throw new Error(
    'Set OROT_PROVIDER_SELECTION_SIMULATOR_UDID to the dedicated Simulator UDID.',
  );
}

if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The provider-selection DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}

module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/provider-selection.jest.config.js',
    },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.provider-selection': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Debug-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Debug -sdk iphonesimulator -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/providerSelectionProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { id: simulatorId },
    },
  },
  configurations: {
    'ios.sim.debug.provider-selection': {
      device: 'simulator',
      app: 'ios.provider-selection',
    },
  },
};
