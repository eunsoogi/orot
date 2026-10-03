/* global by, device, element, waitFor */

const { expect: jestExpect } = require('@jest/globals');

describe('Apple Foundation Models iOS simulator probe', () => {
  it('reads actual availability and reports generation and cancellation when supported', async () => {
    await device.launchApp();

    const result = element(by.id('apple-foundation-models-probe-complete'));
    await waitFor(result).toBeVisible().withTimeout(240000);
    const attributes = await result.getAttributes();
    const summary = attributes.label || attributes.text;

    jestExpect(summary).toContain('availability=');
    jestExpect(summary).toContain('inferenceStop=unverified');
    if (summary.includes('availability=available')) {
      jestExpect(summary).toContain('generation=passed');
      jestExpect(summary).toContain('sourceIdPreserved=passed');
      jestExpect(summary).toMatch(/cancellation=(cancelled|completed-before-cancel)/);
    } else {
      jestExpect(summary).toContain('generation=not-run');
      jestExpect(summary).toContain('sourceIdPreserved=not-run');
      jestExpect(summary).toContain('cancellation=not-run');
    }
    console.log('APPLE_FOUNDATION_MODELS_RUNTIME ' + summary);
  });
});
