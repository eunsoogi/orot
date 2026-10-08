'use strict';

const JEST_TEST_TIMEOUT_MS = 360_000;

/**
 * The three fixtures run sequentially and can make five bounded API calls total.
 * Reserve one minute beyond their 5 × 60-second request ceiling for graph teardown.
 */
function buildJestArguments({ jestConfig, integrationTest }) {
  return [
    '--config',
    jestConfig,
    '--runInBand',
    '--runTestsByPath',
    integrationTest,
    `--testTimeout=${JEST_TEST_TIMEOUT_MS}`,
  ];
}

module.exports = { JEST_TEST_TIMEOUT_MS, buildJestArguments };
