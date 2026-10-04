/** @type {Detox.DetoxConfig} */
const simulatorId = process.env.OROT_CALENDAR_DETOX_SIMULATOR_UDID;

if (!simulatorId) {
  throw new Error('OROT_CALENDAR_DETOX_SIMULATOR_UDID must name the assigned simulator.');
}

module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/calendar.jest.config.js',
    },
    jest: { setupTimeout: 120000 },
  },
  apps: {
    'ios.release.calendar': {
      type: 'ios.app',
      binaryPath: 'ios/build-calendar/Build/Products/Release-iphonesimulator/Orot.app',
      build: "DEVELOPMENT_TEAM=OROTSIM000 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination \"platform=iOS Simulator,id=$OROT_CALENDAR_DETOX_SIMULATOR_UDID\" -derivedDataPath ios/build-calendar CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- GCC_PREPROCESSOR_DEFINITIONS='$(inherited) OROT_CALENDAR_DETOX=1' SWIFT_ACTIVE_COMPILATION_CONDITIONS='$(inherited) RELEASE OROT_CALENDAR_DETOX' OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements ENTRY_FILE=e2e/calendarProbeEntry.tsx",
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { id: simulatorId },
    },
  },
  configurations: {
    'ios.sim.release.calendar': {
      device: 'simulator',
      app: 'ios.release.calendar',
    },
  },
};
