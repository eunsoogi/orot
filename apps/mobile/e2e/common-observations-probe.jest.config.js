module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/common-observations-probe.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 240000,
};
