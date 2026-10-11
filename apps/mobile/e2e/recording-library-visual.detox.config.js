const baseConfig = require('./transcription.detox.config.js');

module.exports = {
  ...baseConfig,
  testRunner: {
    ...baseConfig.testRunner,
    args: {
      ...baseConfig.testRunner.args,
      config: 'e2e/recording-library-visual.jest.config.js',
    },
  },
};
