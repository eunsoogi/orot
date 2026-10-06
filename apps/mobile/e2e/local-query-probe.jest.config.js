const base = require('./jest.config.js');

module.exports = {
  ...base,
  testTimeout: 240000,
  testMatch: ['<rootDir>/e2e/local-query-probe.e2e.js'],
};
