module.exports = {
  ...require('./jest.config.js'),
  testMatch: [
    '<rootDir>/e2e/transcription.e2e.js',
    '<rootDir>/e2e/recordingExport.e2e.js',
  ],
  testPathIgnorePatterns: [],
  // Preserve the longer native-speech window while export keeps its own shorter limit.
  testTimeout: 600000,
};
