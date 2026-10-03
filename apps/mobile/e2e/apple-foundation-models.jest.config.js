module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/appleFoundationModels.test.js'],
  testPathIgnorePatterns: [],
  testTimeout: 240000,
};
