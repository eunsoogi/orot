module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/visit-questions.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 240000,
};
