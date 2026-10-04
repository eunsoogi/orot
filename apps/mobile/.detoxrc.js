/** @type {Detox.DetoxConfig} */
const simulatorId = process.env.OROT_DETOX_SIMULATOR_UDID;
const releaseDerivedDataPath =
  process.env.OROT_DETOX_RELEASE_DERIVED_DATA_PATH || 'ios/build';

if (!/^[A-Za-z0-9_./-]+$/.test(releaseDerivedDataPath)) {
  throw new Error(
    'The Detox Release DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}

module.exports = {
  behavior: {
    init: { reinstallApp: true },
  },
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/release-e2e.jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  artifacts: {
    plugins: {
      screenshot: {
        enabled: true,
        shouldTakeAutomaticSnapshots: true,
        keepOnlyFailedTestsArtifacts: true,
        takeWhen: { testStart: false, testFailure: true, testDone: false },
      },
    },
  },
  apps: {
    'ios.release': {
      type: 'ios.app',
      binaryPath: `${releaseDerivedDataPath}/Build/Products/Release-iphonesimulator/Orot.app`,
      build: `DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ${releaseDerivedDataPath} CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES -showBuildTimingSummary ENTRY_FILE=e2e/e2eRouterEntry.tsx`,
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: simulatorId ? { id: simulatorId } : { type: 'iPhone 18 Pro' },
    },
  },
  configurations: {
    'ios.sim.release': {
      device: 'simulator',
      app: 'ios.release',
    },
  },
};
