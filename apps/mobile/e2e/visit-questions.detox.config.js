/** @type {Detox.DetoxConfig} */
const derivedDataPath =
  process.env.OROT_VISIT_QUESTIONS_DERIVED_DATA_PATH ||
  'ios/build-visit-questions';
const simulatorId = process.env.OROT_VISIT_QUESTIONS_SIMULATOR_UDID;

// A dedicated simulator and DerivedData tree prevent this probe from reusing another ticket's app.
if (!simulatorId) {
  throw new Error(
    'OROT_VISIT_QUESTIONS_SIMULATOR_UDID must name the assigned simulator.',
  );
}
if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The visit-question DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/visit-questions.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.release.visit-questions': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Release-iphonesimulator/Orot.app',
      build:
        'DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination "platform=iOS Simulator,id=$OROT_VISIT_QUESTIONS_SIMULATOR_UDID" -derivedDataPath ' +
        derivedDataPath +
        ' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/visitQuestionsProbeEntry.tsx',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { id: simulatorId },
    },
  },
  configurations: {
    'ios.sim.release.visit-questions': {
      device: 'simulator',
      app: 'ios.release.visit-questions',
    },
  },
};
