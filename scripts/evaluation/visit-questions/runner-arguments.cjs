'use strict';

const JEST_TEST_TIMEOUT_MS = 360_000;

/**
 * The three fixture graphs run sequentially with a 45-second graph deadline each.
 * Leave room for all three runs plus Jest and graph teardown overhead.
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
