module.exports = {
  ...require('./jest.config.js'),
  // Keep both flows in one profile suite, with a timeout for each test.
  testMatch: ['<rootDir>/e2e/transcription.e2e.js'],
  testPathIgnorePatterns: [],
  // Preserve the longer native-speech window while export keeps its own shorter limit.
  testTimeout: 600000,
};
