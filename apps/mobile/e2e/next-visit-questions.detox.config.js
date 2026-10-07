/** @type {Detox.DetoxConfig} */
const derivedDataPath =
  process.env.OROT_NEXT_VISIT_QUESTIONS_DERIVED_DATA_PATH ||
  'ios/build-detox-next-visit-questions';
const simulatorId = process.env.OROT_NEXT_VISIT_QUESTIONS_SIMULATOR_UDID;

if (!/^[A-Za-z0-9_./-]+$/.test(derivedDataPath)) {
  throw new Error(
    'The next-visit questions DerivedData path must use only letters, numbers, dots, slashes, underscores, and hyphens.',
  );
}

module.exports = {
  behavior: {
    init: { reinstallApp: true },
  },
  artifacts: {
    plugins: {
      screenshot: {
        enabled: true,
        shouldTakeAutomaticSnapshots: true,
        keepOnlyFailedTestsArtifacts: true,
        takeWhen: { testStart: false, testFailure: true, testDone: false },
      },
    },
  },
  testRunner: {
    args: { $0: 'jest', config: 'e2e/next-visit-questions.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    'ios.next-visit-questions': {
      type: 'ios.app',
      binaryPath:
        derivedDataPath + '/Build/Products/Debug-iphonesimulator/Orot.app',
      // A dedicated entry keeps the deterministic screen probe out of the shipping app route.
      build: `FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ${derivedDataPath} CODE_SIGNING_ALLOWED=NO ENTRY_FILE=e2e/nextVisitQuestionsProbeEntry.tsx`,
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: simulatorId ? { id: simulatorId } : { type: 'iPhone 18 Pro' },
    },
  },
  configurations: {
    'ios.sim.debug.next-visit-questions': {
      device: 'simulator',
      app: 'ios.next-visit-questions',
    },
  },
};
