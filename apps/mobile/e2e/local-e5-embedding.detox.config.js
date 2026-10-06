/** @type {Detox.DetoxConfig} */
const derivedDataPath =
  process.env.OROT_ISSUE24_DERIVED_DATA_PATH || 'ios/build-issue24';
const simulatorId = process.env.OROT_ISSUE24_SIMULATOR_UDID;

if (!simulatorId || !/^[A-Fa-f0-9-]+$/.test(simulatorId)) {
  throw new Error(
    'Set OROT_ISSUE24_SIMULATOR_UDID to the dedicated Simulator UDID.',
  );
}
if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The issue-24 DerivedData path contains unsupported characters.',
  );
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/local-e5-embedding.jest.config.js' },
    jest: { setupTimeout: 900000 },
  },
  apps: {
    'ios.local-e5': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Release-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination "platform=iOS Simulator,id=$OROT_ISSUE24_SIMULATOR_UDID" -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/localE5EmbeddingProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { id: simulatorId },
    },
  },
  configurations: {
    'ios.sim.release.local-e5': { device: 'simulator', app: 'ios.local-e5' },
  },
};
