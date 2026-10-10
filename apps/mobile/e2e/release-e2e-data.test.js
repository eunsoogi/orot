/* global beforeAll, describe, device */

const hasFreshReleaseSimulator =
  process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR === 'true' ||
  process.env.OROT_DETOX_RELEASE_SHARDING === 'true';
const usesCombinedReleaseSimulator =
  !process.env.OROT_DETOX_RELEASE_SHARD &&
  process.env.OROT_DETOX_RELEASE_SHARDING !== 'true';
const {
  releasePhaseResetGuard,
  resetHookTimeoutMs,
} = require('./storageProbeResetGuard.e2e.js');

const releaseShards = require('./release-e2e-shards.js');

function registerFreshPhase(name, suiteFiles, uninstallBeforePhase) {
  describe(name, () => {
    beforeAll(async () => {
      await releasePhaseResetGuard.runReset(async assertMayContinue => {
        if (uninstallBeforePhase) {
          await device.uninstallApp();
          assertMayContinue();
        }
        await device.clearKeychain();
        assertMayContinue();
        // A fresh CI worker has no app at first, while later phases must reinstall after uninstallation.
        if (hasFreshReleaseSimulator || uninstallBeforePhase) {
          await device.installApp();
          assertMayContinue();
        }
      });
    }, resetHookTimeoutMs);

    for (const suiteFile of suiteFiles) require(suiteFile);
  });
}

// The data worker starts with one fresh stateful phase; local combined runs still reinstall after UI phases.
registerFreshPhase(
  'Release stateful data probes',
  releaseShards['release-e2e-data.test.js'],
  usesCombinedReleaseSimulator,
);
