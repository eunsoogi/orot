module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/checkpoint.detox.e2e.js'],
  testPathIgnorePatterns: [],
};
