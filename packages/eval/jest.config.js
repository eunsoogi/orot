const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '../../apps/mobile');
const mobileConfig = require(path.join(mobileRoot, 'jest.config.js'));
const mobilePresetRoot = path.dirname(
  require.resolve('@react-native/jest-preset', { paths: [mobileRoot] }),
);
const manualVisitQuestionEval = process.env.OROT_RUN_VISIT_QUESTION_EVAL === '1';
const testPathIgnorePatterns = [...(mobileConfig.testPathIgnorePatterns ?? [])];

// Keep the opt-in app-graph exercise out of the default no-skips unit inventory.
if (!manualVisitQuestionEval) {
  testPathIgnorePatterns.push('<rootDir>/__tests__/visitQuestionWorkflow.integration.test.ts');
}

module.exports = {
  ...mobileConfig,
  preset: mobilePresetRoot,
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  testPathIgnorePatterns,
  transform: {
    '^.+\\.[jt]sx?$': [
      require.resolve('babel-jest', { paths: [mobileRoot] }),
      {
        configFile: path.join(mobileRoot, 'babel.config.js'),
      },
    ],
  },
};
