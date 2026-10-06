/* global by, device, element, waitFor */

const {
  createStorageResetGuard,
  installFreshApp,
} = require('./storageProbeResetGuard.e2e.js');
const resetGuard = createStorageResetGuard();

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
  it('creates encrypted source and evidence records on fresh install', async () => {
    await installFreshApp(device, resetGuard);
    await launchProbe('fresh', false);
    await expectProbeSuccess('fresh');
  }, 240000);

  it('reopens a source and its evidence span after an app process restart', async () => {
    // Reuse records created by the first case so restart coverage avoids another Simulator reset.
    await launchProbe('fresh', false);
    await expectProbeSuccess('fresh');
    await device.terminateApp();
    await launchProbe('restart', true);
    await expectProbeSuccess('restart');
  });

  it('migrates the earlier test schema on fresh install', async () => {
    await installFreshApp(device, resetGuard);
    await launchProbe('legacy', false);
    await expectProbeSuccess('legacy');
  }, 240000);
});
