const base = require('./jest.config.js');

module.exports = {
  ...base,
  // A timed-out setup may keep changing the shared Simulator; stop before later cases reuse its state.
  // The summary guard still requires the full inventory to pass on successful runs.
  bail: 1,
  testMatch: ['<rootDir>/e2e/release-e2e.test.js'],
  testPathIgnorePatterns: [],
};
