// Keep the native playback lifecycle suite independent from visual review probes.
module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/recording-playback.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 180000,
};
