const path = require('node:path');

module.exports = {
  preset: '@react-native/jest-preset',
  // Package Jest configs reuse this one with another rootDir, so keep the app mock resolvable.
  setupFilesAfterEnv: [
    path.resolve(__dirname, 'test-support/navigationGlassViewMock.js'),
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(?:((jest-)?react-native|@react-native(-community)?)/|\\.pnpm/(?:react-native@|@react-native(?:-community)?\\+)[^/]+/node_modules/))',
  ],
};
