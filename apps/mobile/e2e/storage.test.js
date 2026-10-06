/* global by, device, element, waitFor */

const {
  createStorageResetGuard,
  installFreshApp,
} = require('./storageProbeResetGuard.e2e.js');
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
      await installFreshApp(device, resetGuard);
      await launchProbe('fresh', false);
      await expectProbeSuccess('fresh');
    },
    freshResetTimeoutMs,
  );

  it('reopens a source and its evidence span after an app process restart', async () => {
    // Recreate records without another Simulator reset so this case stays independent of earlier test results.
    await launchProbe('fresh', false);
    await expectProbeSuccess('fresh');
    await device.terminateApp();
    await launchProbe('restart', true);
    await expectProbeSuccess('restart');
  });

  it(
    'migrates the earlier test schema on fresh install',
    async () => {
      await installFreshApp(device, resetGuard);
      await launchProbe('legacy', false);
      await expectProbeSuccess('legacy');
    },
    freshResetTimeoutMs,
  );
});
