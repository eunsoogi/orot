module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/blood-pressure-visual-probe.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 90000,
};
