/* global by, device, element, waitFor */

describe('on-device multilingual E5 embeddings', () => {
  it('measures Korean retrieval and memory, cancels a native batch, and reads the persisted index after relaunch', async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({
      newInstance: false,
      launchArgs: { OROT_LOCAL_E5_PROBE: 'fresh' },
    });
    await waitFor(element(by.id('local-e5-probe-success')))
      .toBeVisible()
      .withTimeout(900000);

    await device.terminateApp();
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_LOCAL_E5_PROBE: 'restart' },
    });
    await waitFor(element(by.id('local-e5-probe-success')))
      .toBeVisible()
      .withTimeout(300000);
  });
});
