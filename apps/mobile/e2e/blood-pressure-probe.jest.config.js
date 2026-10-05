module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/blood-pressure-probe.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 60000,
};
