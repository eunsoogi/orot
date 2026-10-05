/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('ChatGPT local tool calling on iOS Simulator', () => {
  it('streams a normalized function call and returns its local result for final completion', async () => {
    await device.launchApp();
    const result = element(by.id('openai-tools-provider-probe-result'));
    await waitFor(result).toBeVisible().withTimeout(240000);
    const attributes = await result.getAttributes();
    const summary = attributes.label || attributes.text;
    if (summary.startsWith('ChatGPT local tool probe failed'))
      throw new Error(summary);
    jestExpect(summary).toContain('definitions=mapped');
    jestExpect(summary).toContain('stream=normalized');
    jestExpect(summary).toContain('result=round-trip');
    jestExpect(summary).toContain('hostedTools=rejected');
    jestExpect(summary).toContain('realAccount=unverified');
    jestExpect(summary).not.toContain('synthetic-access-token');
    console.log('OPENAI_TOOLS_PROVIDER_SIMULATOR ' + summary);
  });
});
