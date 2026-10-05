/** @type {Detox.DetoxConfig} */
// This probe uses separate app entry and DerivedData from the shared HealthKit probe.
const derivedDataPath =
  process.env.OROT_COMMON_OBSERVATIONS_DERIVED_DATA_PATH ||
  'ios/build-common-observations-probe';
const simulatorId = process.env.OROT_COMMON_OBSERVATIONS_SIMULATOR_UDID;

if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The common observation DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}

module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/common-observations-probe.jest.config.js',
    },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.common-observations-probe': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Debug-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Debug -sdk iphonesimulator -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/commonObservationsProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: simulatorId ? { id: simulatorId } : { type: 'iPhone 18 Pro' },
    },
  },
  configurations: {
    'ios.sim.debug.common-observations': {
      device: 'simulator',
      app: 'ios.common-observations-probe',
    },
  },
};
