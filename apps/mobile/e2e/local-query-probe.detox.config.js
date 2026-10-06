/** @type {Detox.DetoxConfig} */
// Keep the local-query proof on a dedicated Simulator and DerivedData path.
const derivedDataPath =
  process.env.OROT_LOCAL_QUERY_DERIVED_DATA_PATH ||
  'ios/build-local-query-probe';
const simulatorId = process.env.OROT_LOCAL_QUERY_SIMULATOR_UDID;

if (!simulatorId || !/^[A-Fa-f0-9-]+$/.test(simulatorId)) {
  throw new Error(
    'Set OROT_LOCAL_QUERY_SIMULATOR_UDID to the dedicated Simulator UDID.',
  );
}
if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The local-query DerivedData path contains unsupported characters.',
  );
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/local-query-probe.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.local-query-probe': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Release-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination "platform=iOS Simulator,id=$OROT_LOCAL_QUERY_SIMULATOR_UDID" -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/localRecordQueryProbeEntry.tsx',
    },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { id: simulatorId } },
  },
  configurations: {
    'ios.sim.release.local-query-probe': {
      device: 'simulator',
      app: 'ios.local-query-probe',
    },
  },
};
