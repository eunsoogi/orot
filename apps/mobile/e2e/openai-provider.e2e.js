/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('ChatGPT plan provider on iOS Simulator', () => {
  it('discovers visible models and bridges completed, usage-limit, and cancellation events', async () => {
    await device.launchApp();
    const result = element(by.id('openai-provider-probe-result'));
    await waitFor(result).toBeVisible().withTimeout(240000);
    const attributes = await result.getAttributes();
    const summary = attributes.label || attributes.text;
    if (summary.startsWith('ChatGPT plan provider probe failed'))
      throw new Error(summary);
    jestExpect(summary).toContain('catalog=visible-model-only');
    jestExpect(summary).toContain('terminal=completed');
    jestExpect(summary).toContain('usageLimit=rate_limited');
    jestExpect(summary).toContain('cancellation=resolved');
    jestExpect(summary).toContain('realAccount=unverified');
    jestExpect(summary).not.toContain('synthetic-access-token');
    console.log('OPENAI_PROVIDER_SIMULATOR ' + summary);
  });
});
