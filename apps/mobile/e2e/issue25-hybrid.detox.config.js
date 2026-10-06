/** @type {Detox.DetoxConfig} */
// Keep the SQLCipher/FTS5 proof on its dedicated Simulator and DerivedData path.
const derivedDataPath =
  process.env.OROT_ISSUE25_DERIVED_DATA_PATH || 'ios/build-issue25';
const simulatorId = process.env.OROT_ISSUE25_SIMULATOR_UDID;

if (!simulatorId || !/^[A-Fa-f0-9-]+$/.test(simulatorId)) {
  throw new Error(
    'Set OROT_ISSUE25_SIMULATOR_UDID to the dedicated Simulator UDID.',
  );
}
if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The issue-25 DerivedData path contains unsupported characters.',
  );
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/issue25-hybrid.jest.config.js' },
    jest: { setupTimeout: 900000 },
  },
  apps: {
    'ios.issue25-hybrid': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Release-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination "platform=iOS Simulator,id=$OROT_ISSUE25_SIMULATOR_UDID" -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/issue25HybridRetrievalProbeEntry.tsx',
    },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { id: simulatorId } },
  },
  configurations: {
    'ios.sim.release.issue25-hybrid': {
      device: 'simulator',
      app: 'ios.issue25-hybrid',
    },
  },
};
