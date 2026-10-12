const simulatorId = process.env.OROT_ISSUE191_SIMULATOR_UDID;
if (!simulatorId)
  throw new Error('A dedicated issue 191 Simulator is required.');

module.exports = {
  // Reinstallation removes SQLCipher data but retains its keychain key. Install
  // builds with simctl install and preserve this dedicated fixture across runs.
  behavior: { init: { reinstallApp: false } },
  testRunner: {
    args: { $0: 'jest', config: 'e2e/issue191.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    diagnostic: {
      type: 'ios.app',
      binaryPath:
        'ios/build-issue-191/Build/Products/Release-iphonesimulator/Orot.app',
    },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { id: simulatorId } },
  },
  configurations: {
    'ios.sim.release.issue191': { device: 'simulator', app: 'diagnostic' },
  },
};
