const path = require('node:path');

module.exports = {
  preset: '@react-native/jest-preset',
  // Package Jest configs reuse this one with another rootDir, so keep the app mock resolvable.
  setupFilesAfterEnv: [
    path.resolve(__dirname, 'test-support/appointmentReminderModuleMock.js'),
    path.resolve(__dirname, 'test-support/navigationGlassViewMock.js'),
    path.resolve(__dirname, 'test-support/navigationMotionMock.js'),
    path.resolve(__dirname, 'test-support/assistantAppearanceFixture.js'),
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(?:((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-chart-kit)/|\\.pnpm/(?:react-native@|@react-native(?:-community)?\\+|@react-navigation\\+|react-native-screens@|react-native-chart-kit@)[^/]+/node_modules/))',
  ],
};
