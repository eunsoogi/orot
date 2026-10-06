/** @type {Detox.DetoxConfig} */
const derivedDataPath = process.env.OROT_BLOOD_PRESSURE_DERIVED_DATA_PATH;
const simulatorId = process.env.OROT_BLOOD_PRESSURE_SIMULATOR_UDID;
const metroPort = process.env.OROT_BLOOD_PRESSURE_METRO_PORT || '8218';

// Require an explicitly owned simulator so this probe cannot fall back to #16's open prompt.
if (!simulatorId || !/^[0-9A-Fa-f-]{36}$/.test(simulatorId)) {
  throw new Error(
    'Set OROT_BLOOD_PRESSURE_SIMULATOR_UDID to the dedicated Simulator UUID.',
  );
}
if (!derivedDataPath || !/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error('Set a dedicated OROT_BLOOD_PRESSURE_DERIVED_DATA_PATH.');
}
if (!/^\d{4,5}$/.test(metroPort)) {
  throw new Error('OROT_BLOOD_PRESSURE_METRO_PORT must be a numeric port.');
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/blood-pressure-probe.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.blood-pressure-probe': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Debug-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Debug -sdk iphonesimulator -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/bloodPressureProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { id: simulatorId },
    },
  },
  configurations: {
    'ios.sim.debug.blood-pressure-probe': {
      device: 'simulator',
      app: 'ios.blood-pressure-probe',
    },
  },
};
