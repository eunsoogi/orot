/* global by, device, element, waitFor */

async function expectProbeSuccess(mode) {
  await waitFor(element(by.id('storage-probe-' + mode + '-success')))
    .toBeVisible()
    .withTimeout(30000);
}

describe('encrypted local storage', () => {
  it('creates a Keychain key on fresh install, reopens after restart, and migrates the earlier schema', async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({ launchArgs: { OROT_STORAGE_PROBE: 'fresh' } });
    await expectProbeSuccess('fresh');

    await device.terminateApp();
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_STORAGE_PROBE: 'restart' },
    });
    await expectProbeSuccess('restart');

    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({ launchArgs: { OROT_STORAGE_PROBE: 'legacy' } });
    await expectProbeSuccess('legacy');
  });
});
