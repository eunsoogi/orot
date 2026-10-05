/* global by, device, element, waitFor */

const { createStorageResetGuard } = require('./storageProbeResetGuard.e2e.js');
const resetGuard = createStorageResetGuard();
// A hosted uninstall, Keychain clear, and install took 173s; give only reset cases a four-minute limit.
const freshResetTimeoutMs = 240000;

beforeEach(() => resetGuard.assertResetMayContinue());
afterEach(() => resetGuard.afterTest());

async function expectProbeSuccess(mode) {
  await waitFor(element(by.id('storage-probe-' + mode + '-success')))
    .toBeVisible()
    .withTimeout(30000);
}

async function installFreshApp() {
  // Detox reinstalls once per worker; storage cases reset the app sandbox and Keychain independently.
  resetGuard.beginReset();
  try {
    await device.uninstallApp();
    resetGuard.assertResetMayContinue();
    await device.clearKeychain();
    resetGuard.assertResetMayContinue();
    await device.installApp();
    resetGuard.assertResetMayContinue();
  } finally {
    resetGuard.finishReset();
  }
}

async function launchProbe(mode, newInstance) {
  await device.launchApp({
    newInstance,
    launchArgs: { OROT_STORAGE_PROBE: mode },
  });
}

describe('encrypted local storage', () => {
  it(
    'creates encrypted source and evidence records on fresh install',
    async () => {
      await installFreshApp();
      await launchProbe('fresh', false);
      await expectProbeSuccess('fresh');
    },
    freshResetTimeoutMs,
  );

  it('reopens a source and its evidence span after an app process restart', async () => {
    // Reuse the first case's records so process-restart coverage needs no second fresh install.
    await device.terminateApp();
    await launchProbe('restart', true);
    await expectProbeSuccess('restart');
  });

  it(
    'migrates the earlier test schema on fresh install',
    async () => {
      await installFreshApp();
      await launchProbe('legacy', false);
      await expectProbeSuccess('legacy');
    },
    freshResetTimeoutMs,
  );
});
