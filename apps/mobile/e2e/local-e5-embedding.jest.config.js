module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/localE5Embedding.test.js'],
  testPathIgnorePatterns: [],
  testTimeout: 1_200_000,
};
