module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/transcription.e2e.js'],
  testPathIgnorePatterns: [],
  // Let the native report and transcript delete/relaunch checks reach their own bounded waits.
  testTimeout: 600000,
};
