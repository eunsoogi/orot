/** @type {Detox.DetoxConfig} */
const simulatorId = process.env.OROT_DETOX_SIMULATOR_UDID;

module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/release-e2e.jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/Orot.app',
      build: `DEVELOPMENT_TEAM=OROTSIM000 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -arch "$(uname -m)" -derivedDataPath ios/build CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES -showBuildTimingSummary ENTRY_FILE=e2e/e2eRouterEntry.tsx`,
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
