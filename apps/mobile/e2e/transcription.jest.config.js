module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/transcription.e2e.js'],
  testPathIgnorePatterns: [],
  // A freshly provisioned runtime can spend several minutes on first launch.
  // Bound the full native, review/deletion, and export scenario; retain each operation deadline.
  testTimeout: 1200000,
};
