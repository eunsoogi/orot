/* global beforeAll, device */

const hasFreshReleaseSimulator =
  process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR === 'true' ||
  process.env.OROT_DETOX_RELEASE_SHARDING === 'true';
const {
  releasePhaseResetGuard,
  resetHookTimeoutMs,
} = require('./storageProbeResetGuard.e2e.js');

beforeAll(async () => {
  await releasePhaseResetGuard.runReset(async assertMayContinue => {
    await device.clearKeychain();
    assertMayContinue();
    // Explicit shard runs start from a fresh device without an installed app.
    if (hasFreshReleaseSimulator) {
      await device.installApp();
      assertMayContinue();
    }
  });
}, resetHookTimeoutMs);

// Keep first-use, data mutation, and migration probes ordered on one data worker to avoid a third active Simulator.
for (const suiteFile of require('./release-e2e-shards.js')[
  'release-e2e-data.test.js'
]) {
  require(suiteFile);
}
