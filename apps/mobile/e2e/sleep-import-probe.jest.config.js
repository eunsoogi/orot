module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/sleep-import-probe.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 240000,
};
