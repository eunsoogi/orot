module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/transcription.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 240000,
};
