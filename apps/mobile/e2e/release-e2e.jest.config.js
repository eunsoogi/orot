const base = require('./jest.config.js');
const releaseE2EShards = require('./release-e2e-shards.js');

const releaseShardPaths = Object.keys(releaseE2EShards).map(
  wrapper => `<rootDir>/e2e/${wrapper}`,
);
const selectedShard = process.env.OROT_DETOX_RELEASE_SHARD;

if (
  selectedShard &&
  !Object.prototype.hasOwnProperty.call(releaseE2EShards, selectedShard)
) {
  throw new Error(`Unknown Release Detox shard: ${selectedShard}`);
}

// Keep hosted single-wrapper processes pinned to pre-created Simulators; local combined discovery stays unchanged.
const testMatch = selectedShard
  ? [`<rootDir>/e2e/${selectedShard}`]
  : releaseShardPaths;

module.exports = {
  ...base,
  // Stop later suites after failure; storage.test.js also guards later cases during a timed-out reset.
  bail: 1,
  // The default combined command keeps one worker per wrapper; hosted isolated shards use one process and device.
  maxWorkers: selectedShard ? 1 : releaseShardPaths.length,
  testMatch,
  testPathIgnorePatterns: [],
};
