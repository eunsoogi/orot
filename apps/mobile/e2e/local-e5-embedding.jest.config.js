module.exports = {
  ...require('./jest.config.js'),
  // This probe requires the E5 entry bundle to expose its result selector.
  testMatch: ['<rootDir>/e2e/localE5Embedding.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 1_200_000,
};
