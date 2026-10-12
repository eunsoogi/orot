module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/issue191*.native.test.js'],
  testPathIgnorePatterns: [],
  testTimeout: 360000,
};
