module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/provider-selection.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 240000,
};
