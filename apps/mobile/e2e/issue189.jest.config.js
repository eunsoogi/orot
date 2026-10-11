const probe = process.env.OROT_ISSUE189_PROBE;
const probes = [
  'apple-workflow',
  'rag',
  'ui',
  'calendar',
  'automatic-transcription',
];
if (!probes.includes(probe)) throw new Error('Select a known issue 189 probe.');

module.exports = {
  ...require('./jest.config.js'),
  testMatch: [`<rootDir>/e2e/issue189-${probe}.native.test.js`],
  testPathIgnorePatterns: [],
  testTimeout: 360000,
};
