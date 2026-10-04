/* global by, device, element, waitFor */

describe('SQLCipher-backed agent memory', () => {
  it('persists, corrects, recalls and removes Korean memory with its source', async () => {
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
  });
});
