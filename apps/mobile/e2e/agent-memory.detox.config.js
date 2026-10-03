/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/agent-memory.jest.config.js',
    },
    jest: { setupTimeout: 120000 },
  },
  apps: {
    'ios.agent-memory': {
      type: 'ios.app',
      binaryPath: 'ios/build-agent-memory/Build/Products/Release-iphonesimulator/Orot.app',
      build: 'DEVELOPMENT_TEAM=OROTSIM000 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -derivedDataPath ios/build-agent-memory CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/agentMemoryProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { type: 'iPhone 18 Pro' },
    },
  },
  configurations: {
    'ios.sim.release.agent-memory': {
      device: 'simulator',
      app: 'ios.agent-memory',
    },
  },
};
