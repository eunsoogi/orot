const exportNamespacePlugin = require.resolve(
  '@babel/plugin-transform-export-namespace-from',
  { paths: [require.resolve('@babel/preset-env')] },
);

module.exports = {
  plugins: [exportNamespacePlugin],
  presets: ['module:@react-native/babel-preset'],
  overrides: [
    {
      // LangChain messages brand instanceof through fields initialized after super().
      // Babel's ES5 class guard checks that brand too early; Hermes supports native classes.
      test: /[/\\]@langchain[/\\]core[/\\]dist[/\\]messages[/\\].*\.[cm]?js$/,
      presets: [
        [
          'module:@react-native/babel-preset',
          { unstable_transformProfile: 'hermes-stable' },
        ],
      ],
    },
  ],
};
