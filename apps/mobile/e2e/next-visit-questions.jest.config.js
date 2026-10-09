module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/next-visit-questions.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout: 120000,
};
