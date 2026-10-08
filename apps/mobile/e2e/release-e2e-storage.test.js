/* global beforeAll, device */

beforeAll(async () => {
  await device.clearKeychain();
});

// Fresh-install and migration resets use a separate worker Simulator from the other probes.
for (const suiteFile of require('./release-e2e-shards.js')[
  'release-e2e-storage.test.js'
]) {
  require(suiteFile);
}
