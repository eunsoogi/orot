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

const statefulSuites = releaseShards['release-e2e-data.test.js'].filter(
  suiteFile => suiteFile !== './safe-area.test.js',
);
const safeAreaSuites = releaseShards['release-e2e-data.test.js'].filter(
  suiteFile => suiteFile === './safe-area.test.js',
);

// Safe Area startup probes run before stateful data tests and hand off a clean app installation.
registerFreshPhase(
  'Release Safe Area probes',
  safeAreaSuites,
  usesCombinedReleaseSimulator,
);
registerFreshPhase('Release stateful data probes', statefulSuites, true);
