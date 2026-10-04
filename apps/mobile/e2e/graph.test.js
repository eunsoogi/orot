/* global by, device, element, waitFor */

describe('LangGraph on React Native Hermes', () => {
  it('invokes and consumes a stateful two-node graph 20 consecutive times', async () => {
    await device.launchApp({ launchArgs: { OROT_E2E_PROBE: 'graph' } });
    await waitFor(element(by.id('agent-graph-success')))
      .toBeVisible()
      .withTimeout(30000);
  });
});
