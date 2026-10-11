const baseConfig = require('./blood-pressure-probe.detox.config.js');

module.exports = {
  ...baseConfig,
  testRunner: {
    ...baseConfig.testRunner,
    args: {
      ...baseConfig.testRunner.args,
      config: 'e2e/blood-pressure-visual-probe.jest.config.js',
    },
  },
};
