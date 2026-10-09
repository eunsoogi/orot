module.exports = {
  ...require('./jest.config.js'),
  setupFilesAfterEnv: ['<rootDir>/e2e/checkpointStandaloneSetup.js'],
  testMatch: ['<rootDir>/e2e/checkpoint.detox.e2e.js'],
  testPathIgnorePatterns: [],
};
