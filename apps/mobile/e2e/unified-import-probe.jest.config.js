module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/unified-import-probe.detox.e2e.js'],
  testPathIgnorePatterns: [],
};
