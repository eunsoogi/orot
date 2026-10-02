const exportNamespacePlugin = require.resolve(
  '@babel/plugin-transform-export-namespace-from',
  { paths: [require.resolve('@babel/preset-env')] },
);

module.exports = {
  plugins: [exportNamespacePlugin],
  presets: ['module:@react-native/babel-preset'],
};
