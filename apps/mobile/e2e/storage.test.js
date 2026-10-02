/* global by, device, element, waitFor */

async function expectProbeSuccess(mode) {
  await waitFor(element(by.id('storage-probe-' + mode + '-success')))
    .toBeVisible()
    .withTimeout(30000);
}

async function installFreshApp() {
  await device.uninstallApp();
  await device.clearKeychain();
  await device.installApp();
}

async function launchProbe(mode, newInstance) {
  await device.launchApp({
    newInstance,
    launchArgs: { OROT_STORAGE_PROBE: mode },
  });
}

describe('encrypted local storage', () => {
  it('creates a Keychain key and stores an encrypted record on fresh install', async () => {
    await installFreshApp();
    await launchProbe('fresh', false);
    await expectProbeSuccess('fresh');
  });

  it('reopens the stored record after an app process restart', async () => {
    await installFreshApp();
    await launchProbe('fresh', false);
    await expectProbeSuccess('fresh');
    await device.terminateApp();
    await launchProbe('restart', true);
    await expectProbeSuccess('restart');
  });

  it('migrates the earlier test schema on fresh install', async () => {
    await installFreshApp();
    await launchProbe('legacy', false);
    await expectProbeSuccess('legacy');
  });
});
