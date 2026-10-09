/* global by, device, element, waitFor */

// Keep four minutes for the first probe on a clean device; hosted setup-to-launch took about 141 seconds.
const freshInstallProbeTimeoutMs = 240000;

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
      // The Release wrapper installs this app on its clean Simulator before the first storage probe.
      await launchProbe('fresh', false);
      await expectProbeSuccess('fresh');
    },
    freshInstallProbeTimeoutMs,
  );

  it('reopens a source and its evidence span after an app process restart', async () => {
    // Recreate records in the phase-owned install so this case stays independent of earlier test results.
    await launchProbe('fresh', false);
    await expectProbeSuccess('fresh');
    await device.terminateApp();
    await launchProbe('restart', true);
    await expectProbeSuccess('restart');
  });
});
