module.exports = {
  ...require('./jest.config.js'),
  testMatch: [
    '<rootDir>/e2e/transcription.e2e.js',
    '<rootDir>/e2e/recordingExport.e2e.js',
  ],
  testPathIgnorePatterns: [],
  // Speech and export scenarios own separate test deadlines despite sharing the same Simulator profile.
  testTimeout: 600000,
};
