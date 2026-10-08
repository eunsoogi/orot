/* global by, device, element, waitFor */

describe('SQLCipher-backed agent memory', () => {
  it('keeps removed source data out of memory and hybrid search after relaunch', async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_AGENT_MEMORY_PROBE: 'fresh' },
    });
    await waitFor(element(by.id('agent-memory-probe-success')))
      .toBeVisible()
      .withTimeout(30000);

    await device.terminateApp();
    await device.launchApp({
      newInstance: false,
      launchArgs: { OROT_AGENT_MEMORY_PROBE: 'restart' },
    });
    await waitFor(element(by.id('agent-memory-probe-success')))
      .toBeVisible()
      .withTimeout(30000);

    // Reintroduce the same stale graph chunk after relaunch to exercise persistent search fences.
    await device.terminateApp();
    await device.launchApp({
      newInstance: false,
      launchArgs: { OROT_AGENT_MEMORY_PROBE: 'verify-deletion' },
    });
    await waitFor(element(by.id('agent-memory-probe-success')))
      .toBeVisible()
      .withTimeout(30000);
  });
});
