/** @type {Detox.DetoxConfig} */
// Requires the lane-assigned Simulator; the probe must not erase a personal device profile.
const derivedDataPath =
  process.env.OROT_UNIFIED_IMPORT_DERIVED_DATA_PATH ||
  'ios/build-unified-import-probe';
const simulatorId = process.env.OROT_UNIFIED_IMPORT_SIMULATOR_UDID;

if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The unified import DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}
if (!simulatorId) {
  throw new Error(
    'OROT_UNIFIED_IMPORT_SIMULATOR_UDID must name the assigned simulator.',
  );
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/unified-import-probe.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.debug.unified-import-probe': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Debug-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,id=$OROT_UNIFIED_IMPORT_SIMULATOR_UDID" -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/unifiedImportProbeEntry.tsx',
    },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { id: simulatorId } },
  },
  configurations: {
    'ios.sim.debug.unified-import-probe': {
      device: 'simulator',
      app: 'ios.debug.unified-import-probe',
    },
  },
};
