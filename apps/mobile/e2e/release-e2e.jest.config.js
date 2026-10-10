const base = require('./jest.config.js');
const releaseE2EShards = require('./release-e2e-shards.js');

const selectedShard = process.env.OROT_DETOX_RELEASE_SHARD;

if (
  selectedShard &&
  !Object.prototype.hasOwnProperty.call(releaseE2EShards, selectedShard)
) {
  throw new Error(`Unknown Release Detox shard: ${selectedShard}`);
}

// The default wrapper keeps UI, Safe Area, and stateful phases ordered on one Simulator.
const testMatch = selectedShard
  ? [`<rootDir>/e2e/${selectedShard}`]
  : ['<rootDir>/e2e/release-e2e.test.js'];

module.exports = {
  ...base,
  // Stop later suites after failure; storage.test.js also guards later cases during a timed-out reset.
  bail: 1,
  // Serial execution preserves the suite order and avoids cloning a second Simulator for the default CI path.
  maxWorkers: 1,
  testMatch,
  testPathIgnorePatterns: [],
};
