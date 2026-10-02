module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!(?:((jest-)?react-native|@react-native(-community)?)/|\\.pnpm/(?:react-native@|@react-native(?:-community)?\\+)[^/]+/node_modules/))',
  ],
};
