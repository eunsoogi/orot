const base = require('./jest.config.js');

module.exports = {
  ...base,
  // Stop later suites after failure; storage.test.js also guards later cases during a timed-out reset.
  bail: 1,
  testMatch: ['<rootDir>/e2e/release-e2e.test.js'],
  testPathIgnorePatterns: [],
};
