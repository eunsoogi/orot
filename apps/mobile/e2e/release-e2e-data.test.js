/* global beforeAll, device */

const hasFreshReleaseSimulator =
  process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR === 'true' ||
  process.env.OROT_DETOX_RELEASE_SHARDING === 'true';

beforeAll(async () => {
  await device.clearKeychain();
  // Explicit shard runs start from a fresh device without an installed app.
  if (hasFreshReleaseSimulator) {
    await device.installApp();
  }
});

// Keep first-use, data mutation, and migration probes ordered on one data worker to avoid a third active Simulator.
for (const suiteFile of require('./release-e2e-shards.js')[
  'release-e2e-data.test.js'
]) {
  require(suiteFile);
}
