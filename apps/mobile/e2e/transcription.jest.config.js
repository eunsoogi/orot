module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/transcription.e2e.js'],
  testPathIgnorePatterns: [],
  // Bound both sequential Simulator phases while leaving time for native Speech readiness.
  testTimeout: 600000,
};
