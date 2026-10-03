const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/e2e/agentMemory.test.js'],
};
