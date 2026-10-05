/** @type {Detox.DetoxConfig} */
const derivedDataPath =
  process.env.OROT_HEALTHKIT_DERIVED_DATA_PATH || 'ios/build-healthkit-probe';
const simulatorId = process.env.OROT_HEALTHKIT_SIMULATOR_UDID;

if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The HealthKit DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/healthkit-probe.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.healthkit-probe': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Debug-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Debug -sdk iphonesimulator -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/healthkitProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: simulatorId ? { id: simulatorId } : { type: 'iPhone 18 Pro' },
    },
  },
  configurations: {
    'ios.sim.debug.healthkit-probe': {
      device: 'simulator',
      app: 'ios.healthkit-probe',
    },
  },
};
