module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  overrides: [
    {
      // Jest's summary reader must recognize the ANSI escape byte to strip terminal color codes.
      files: ['scripts/ci/require-jest-summary.mjs'],
      rules: {
        'no-control-regex': 'off',
      },
    },
  ],
};
