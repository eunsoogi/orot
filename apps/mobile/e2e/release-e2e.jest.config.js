const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/e2e/release-e2e.test.js'],
  testPathIgnorePatterns: [],
};
