module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/next-visit-questions.e2e.js'],
  testPathIgnorePatterns: [],
  // CI run 38048670805 spent 32.5 s starting XCTest for the debug-toast tap
  // and reached cancel at 120 s. Allow the remaining restore/reload checks;
  // individual UI waits and every assertion retain their existing limits.
  testTimeout: 180000,
};
