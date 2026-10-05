module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/openai-tools-provider.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 240000,
};
