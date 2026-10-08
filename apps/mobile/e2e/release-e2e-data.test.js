/* global beforeAll, device */

beforeAll(async () => {
  await device.clearKeychain();
});

// These routes mutate local data, so they stay ordered on their worker's dedicated Simulator.
for (const suiteFile of require('./release-e2e-shards.js')[
  'release-e2e-data.test.js'
]) {
  require(suiteFile);
}
