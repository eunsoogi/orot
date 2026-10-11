module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/recording-library-visual.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 180000,
};
