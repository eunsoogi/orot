/* global by, device, element, waitFor */

async function expectProbeSuccess(mode) {
  await waitFor(element(by.id('storage-probe-' + mode + '-success')))
    .toBeVisible()
    .withTimeout(30000);
}

async function clearStorageKeychain() {
  // Detox reinstalls the app before each test; Keychain survives that sandbox reset and needs its own reset for these key-loss cases.
  await device.clearKeychain();
}

async function launchProbe(mode, newInstance) {
  await device.launchApp({
    newInstance,
    launchArgs: { OROT_STORAGE_PROBE: mode },
  });
}

describe('encrypted local storage', () => {
  it('creates encrypted source and evidence records on fresh install', async () => {
    await clearStorageKeychain();
    await launchProbe('fresh', false);
    await expectProbeSuccess('fresh');
  });

  it('reopens a source and its evidence span after an app process restart', async () => {
    await clearStorageKeychain();
    await launchProbe('fresh', false);
    await expectProbeSuccess('fresh');
    await device.terminateApp();
    await launchProbe('restart', false);
    await expectProbeSuccess('restart');
  });

  it('migrates the earlier test schema on fresh install', async () => {
    await clearStorageKeychain();
    await launchProbe('legacy', false);
    await expectProbeSuccess('legacy');
  });
});
