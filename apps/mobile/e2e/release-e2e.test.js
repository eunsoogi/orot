/* global beforeAll, device, describe */

const selectedShard = process.env.OROT_DETOX_RELEASE_SHARD;
const releaseE2EShards = require('./release-e2e-shards.js');
const hasFreshReleaseSimulator =
  process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR === 'true' ||
  process.env.OROT_DETOX_RELEASE_SHARDING === 'true';
const usesCombinedReleaseSimulator =
  !selectedShard && process.env.OROT_DETOX_RELEASE_SHARDING !== 'true';

function clearAndInstallFreshSimulator() {
  return beforeAll(async () => {
    await device.clearKeychain();
    // Fresh CI devices have no app to uninstall, so install the built app directly.
    if (hasFreshReleaseSimulator) {
      await device.installApp();
    }
  });
}

function loadReleaseShard(wrapper) {
  for (const suiteFile of releaseE2EShards[wrapper]) require(suiteFile);
}

if (selectedShard) {
  clearAndInstallFreshSimulator();
  loadReleaseShard(selectedShard);
} else {
  describe('Release UI probes', () => {
    clearAndInstallFreshSimulator();
    loadReleaseShard('release-e2e.test.js');
  });

  describe('Release stateful probes', () => {
    beforeAll(async () => {
      // Recreate the stateful phase's fresh app boundary after UI probes on the shared Simulator.
      if (usesCombinedReleaseSimulator) {
        await device.uninstallApp();
        await device.clearKeychain();
        await device.installApp();
      } else {
        await device.clearKeychain();
        if (hasFreshReleaseSimulator) {
          await device.installApp();
        }
      }
    });
    loadReleaseShard('release-e2e-data.test.js');
  });
}
