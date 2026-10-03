/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/symptoms.jest.config.js',
    },
    jest: { setupTimeout: 120000 },
  },
  apps: {
    'ios.release.symptoms': {
      type: 'ios.app',
      binaryPath: 'ios/build-issue22/Build/Products/Release-iphonesimulator/Orot.app',
      build: 'DEVELOPMENT_TEAM=OROTSIM000 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -derivedDataPath ios/build-issue22 CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/storageProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: process.env.OROT_IOS_SIMULATOR_UDID
        ? { id: process.env.OROT_IOS_SIMULATOR_UDID }
        : { type: 'iPhone 18 Pro' },
    },
  },
  configurations: {
    'ios.sim.release.symptoms': {
      device: 'simulator',
      app: 'ios.release.symptoms',
    },
  },
};
