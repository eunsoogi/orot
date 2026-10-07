// Run only the backup-native probe so a slot check cannot launch unrelated E2E suites.
module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/backup.detox.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 240000,
};
