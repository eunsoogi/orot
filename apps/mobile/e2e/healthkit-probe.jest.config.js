module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/healthkit-probe.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 240000,
};
