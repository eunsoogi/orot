/* global beforeAll, device */

beforeAll(async () => {
  await device.clearKeychain();
  // Fresh CI clones have no app container, so install directly instead of uninstalling a missing app first.
  if (process.env.OROT_DETOX_RELEASE_SHARDING === 'true') {
    await device.installApp();
  }
});

for (const suiteFile of require('./release-e2e-shards.js')[
  'release-e2e.test.js'
]) {
  require(suiteFile);
}
