/** Dedicated manual diagnostics; callers build the matching entry before running. */
const simulatorId = process.env.OROT_ISSUE189_SIMULATOR_UDID;
if (!simulatorId)
  throw new Error('A dedicated issue 189 Simulator is required.');

module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/issue189.jest.config.js' },
    jest: { setupTimeout: 240000 },
  },
  apps: {
    diagnostic: {
      type: 'ios.app',
      binaryPath:
        'ios/build-issue-189/Build/Products/Release-iphonesimulator/Orot.app',
    },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { id: simulatorId } },
  },
  configurations: {
    'ios.sim.release.issue189': { device: 'simulator', app: 'diagnostic' },
  },
};
