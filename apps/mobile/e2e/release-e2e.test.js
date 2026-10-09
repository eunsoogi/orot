/* global beforeAll, device, describe */

const selectedShard = process.env.OROT_DETOX_RELEASE_SHARD;
const releaseE2EShards = require('./release-e2e-shards.js');
const hasFreshReleaseSimulator =
  process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR === 'true' ||
  process.env.OROT_DETOX_RELEASE_SHARDING === 'true';
const usesCombinedReleaseSimulator =
  !selectedShard && process.env.OROT_DETOX_RELEASE_SHARDING !== 'true';
const {
  releasePhaseResetGuard,
  resetHookTimeoutMs,
} = require('./storageProbeResetGuard.e2e.js');

function clearAndInstallFreshSimulator() {
  return beforeAll(async () => {
    await releasePhaseResetGuard.runReset(async assertMayContinue => {
      await device.clearKeychain();
      assertMayContinue();
      // Fresh CI devices have no app to uninstall, so install the built app directly.
      if (hasFreshReleaseSimulator) {
        await device.installApp();
        assertMayContinue();
      }
    });
  }, resetHookTimeoutMs);
}

function loadReleaseShard(wrapper) {
  for (const suiteFile of releaseE2EShards[wrapper]) require(suiteFile);
}

if (selectedShard) {
  clearAndInstallFreshSimulator();
  loadReleaseShard(selectedShard);
} else {
  describe('Release fresh-install and UI probes', () => {
    // Run storage creation on this clean install before UI scenarios can open the database.
    clearAndInstallFreshSimulator();
    loadReleaseShard('release-e2e.test.js');
  });

  describe('Release stateful probes', () => {
    beforeAll(async () => {
      await releasePhaseResetGuard.runReset(async assertMayContinue => {
        // Recreate the stateful phase's fresh app boundary after UI probes on the shared Simulator.
        if (usesCombinedReleaseSimulator) {
          await device.uninstallApp();
          assertMayContinue();
          await device.clearKeychain();
          assertMayContinue();
          await device.installApp();
          assertMayContinue();
        } else {
          await device.clearKeychain();
          assertMayContinue();
          if (hasFreshReleaseSimulator) {
            await device.installApp();
            assertMayContinue();
          }
        }
      });
    }, resetHookTimeoutMs);
    loadReleaseShard('release-e2e-data.test.js');
  });
}
