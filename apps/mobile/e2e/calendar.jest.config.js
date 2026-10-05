module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/calendar.detox.e2e.js'],
  testPathIgnorePatterns: [],
};
