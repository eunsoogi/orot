const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/e2e/smoke.test.js',
    '<rootDir>/e2e/appointments.test.js',
    '<rootDir>/e2e/storage.test.js',
    '<rootDir>/e2e/agentMemory.test.js',
    '<rootDir>/e2e/graph.test.js',
    '<rootDir>/e2e/checkpoint.detox.e2e.js',
  ],
  testPathIgnorePatterns: [],
};
