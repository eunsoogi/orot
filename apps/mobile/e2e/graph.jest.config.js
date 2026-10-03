module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/graph.test.js'],
  testPathIgnorePatterns: [],
};
