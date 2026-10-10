/* global by, device, element, waitFor */

// Preserve the bounded allowance for the first app launch after the stateful phase reset.
const migrationProbeTimeoutMs = 240000;

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
    'migrates the earlier test schema on fresh install',
    async () => {
      // The stateful phase provides this clean install before seeding the legacy schema.
      await launchProbe('legacy', false);
      await expectProbeSuccess('legacy');
      // Reopen through appointments after the legacy migration process exits.
      await device.terminateApp();
      await device.launchApp({
        newInstance: true,
        launchArgs: { OROT_E2E_PROBE: 'appointments' },
      });
      await waitFor(element(by.id('appointments-title')))
        .toHaveText('예약')
        .withTimeout(30000);
    },
    migrationProbeTimeoutMs,
  );
});
