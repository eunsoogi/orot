const base = require('./jest.config.js');
const releaseE2EShards = require('./release-e2e-shards.js');

const releaseShardPaths = Object.keys(releaseE2EShards).map(
  wrapper => `<rootDir>/e2e/${wrapper}`,
);

module.exports = {
  ...base,
  // Stop later suites after failure; storage.test.js also guards later cases during a timed-out reset.
  bail: 1,
  // One Jest worker per wrapper keeps its stateful scenarios on one isolated Simulator.
  maxWorkers: releaseShardPaths.length,
  testMatch: releaseShardPaths,
  testPathIgnorePatterns: [],
};
