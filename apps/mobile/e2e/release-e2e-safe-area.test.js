/* global beforeAll, device */

const hasFreshReleaseSimulator =
  process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR === 'true' ||
  process.env.OROT_DETOX_RELEASE_SHARDING === 'true';
const {
  releasePhaseResetGuard,
  resetHookTimeoutMs,
} = require('./storageProbeResetGuard.e2e.js');
// The four Safe Area cases have their own wrapper so hosted CI can run them on a separate Simulator.
const safeAreaSuites = require('./release-e2e-shards.js')[
  'release-e2e-safe-area.test.js'
];

beforeAll(async () => {
  await releasePhaseResetGuard.runReset(async assertMayContinue => {
    await device.clearKeychain();
    assertMayContinue();
    // Isolated shard Simulators have a fresh keychain and need the cached Release app installed.
    if (hasFreshReleaseSimulator) {
      await device.installApp();
      assertMayContinue();
    }
  });
}, resetHookTimeoutMs);

for (const suiteFile of safeAreaSuites) require(suiteFile);
