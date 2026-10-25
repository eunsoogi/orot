const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '../../apps/mobile');
const mobileConfig = require(path.join(mobileRoot, 'jest.config.js'));
const mobilePresetRoot = path.dirname(
  require.resolve('@react-native/jest-preset', { paths: [mobileRoot] }),
);

module.exports = {
  ...mobileConfig,
  preset: mobilePresetRoot,
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@orot/model-runtime$': '<rootDir>/../model-runtime/src/index.ts',
  },
  transform: {
    '^.+\\.[jt]sx?$': [
      require.resolve('babel-jest', { paths: [mobileRoot] }),
      { configFile: path.join(mobileRoot, 'babel.config.js') },
    ],
  },
};
