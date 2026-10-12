const baseConfig = require('./transcription.detox.config.js');

// Reuse the synthetic Release app while selecting only saved-recording playback scenarios.
module.exports = {
  ...baseConfig,
  testRunner: {
    ...baseConfig.testRunner,
    args: {
      ...baseConfig.testRunner.args,
      config: 'e2e/recording-playback.jest.config.js',
    },
  },
};
