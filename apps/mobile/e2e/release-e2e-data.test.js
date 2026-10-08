/* global beforeAll, device */

beforeAll(async () => {
  await device.clearKeychain();
});

// Keep first-use, data mutation, and migration probes ordered on one data worker to avoid a third active Simulator.
for (const suiteFile of require('./release-e2e-shards.js')[
  'release-e2e-data.test.js'
]) {
  require(suiteFile);
}
