/** @type {Detox.DetoxConfig} */
// Keep this native probe on its assigned Simulator and outside shared build products.
const derivedDataPath = process.env.OROT_BACKUP_DERIVED_DATA_PATH;
const simulatorId = process.env.OROT_BACKUP_SIMULATOR_UDID;

if (!derivedDataPath || !/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'Set a dedicated OROT_BACKUP_DERIVED_DATA_PATH before building.',
  );
}
if (!simulatorId || !/^[0-9A-Fa-f-]{36}$/.test(simulatorId)) {
  throw new Error(
    'Set the assigned OROT_BACKUP_SIMULATOR_UDID before building.',
  );
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/backup.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.backup-probe': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Release-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -derivedDataPath ' +
        derivedDataPath +
        " CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements GCC_PREPROCESSOR_DEFINITIONS='$(inherited) OROT_BACKUP_PROBE_TEST=1' OTHER_SWIFT_FLAGS='$(inherited) -DOROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST -DOROT_BACKUP_PROBE_TEST' ENTRY_FILE=e2e/backupProbeEntry.tsx",
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { id: simulatorId },
    },
  },
  configurations: {
    'ios.sim.release.backup': {
      device: 'simulator',
      app: 'ios.backup-probe',
    },
  },
};
