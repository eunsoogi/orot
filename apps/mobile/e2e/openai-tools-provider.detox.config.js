/** @type {Detox.DetoxConfig} */
const derivedDataPath =
  process.env.OROT_OPENAI_TOOLS_PROVIDER_DERIVED_DATA_PATH ||
  'ios/build-openai-tools-provider';
const simulatorId = process.env.OROT_OPENAI_TOOLS_PROVIDER_SIMULATOR_UDID;

if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The OpenAI tools provider DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/openai-tools-provider.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.openai-tools-provider': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Debug-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Debug -sdk iphonesimulator -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/openaiToolsProviderProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: simulatorId ? { id: simulatorId } : { type: 'iPhone 18 Pro' },
    },
  },
  configurations: {
    'ios.sim.debug.openai-tools-provider': {
      device: 'simulator',
      app: 'ios.openai-tools-provider',
    },
  },
};
