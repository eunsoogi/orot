module.exports = {
  ...require('./jest.config.js'),
  // Only the issue-specific SQLCipher/FTS probe is included in this Detox run.
  testMatch: ['<rootDir>/e2e/issue25HybridRetrieval.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 1_200_000,
};
