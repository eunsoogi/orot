/* global beforeAll, device, describe */

const selectedShard = process.env.OROT_DETOX_RELEASE_SHARD;
const releaseE2EShards = require('./release-e2e-shards.js');
const hasFreshReleaseSimulator =
  process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR === 'true' ||
  process.env.OROT_DETOX_RELEASE_SHARDING === 'true';
const {
  releasePhaseResetGuard,
  resetHookTimeoutMs,
} = require('./storageProbeResetGuard.e2e.js');

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
        // Dedicated CI Simulators start empty; combined local runs reinstall only at later phase boundaries.
        if (hasFreshReleaseSimulator || uninstallBeforePhase) {
          await device.installApp();
          assertMayContinue();
        }
      });
    }, resetHookTimeoutMs);

    for (const suiteFile of suiteFiles) require(suiteFile);
  });
}

function registerReleaseUiPhases(wrapper) {
  const suiteFiles = releaseE2EShards[wrapper];
  const safeAreaSuites = suiteFiles.filter(
    suiteFile => suiteFile === './safe-area.test.js',
  );
  const uiSuites = suiteFiles.filter(
    suiteFile => suiteFile !== './safe-area.test.js',
  );

  registerFreshPhase('Release fresh-install and UI probes', uiSuites, false);
  // Safe Area startup probes stay isolated from storage/UI state on the same assigned Simulator.
  if (safeAreaSuites.length > 0) {
    registerFreshPhase('Release Safe Area probes', safeAreaSuites, true);
  }
}

if (selectedShard) {
  if (selectedShard === 'release-e2e-data.test.js') {
    // Stateful data cases use the other dedicated Simulator and keep their local combined-run reset.
    require('./release-e2e-data.test.js');
  } else {
    registerReleaseUiPhases(selectedShard);
  }
} else {
  registerReleaseUiPhases('release-e2e.test.js');

  describe('Release stateful probes', () => {
    require('./release-e2e-data.test.js');
  });
}
