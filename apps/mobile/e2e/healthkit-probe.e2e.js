/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('HealthKit boundary on iOS Simulator', () => {
  it('keeps feature authorization scoped and reports synthetic data honestly', async () => {
    await device.launchApp();
    const result = element(by.id('healthkit-probe-result'));
    await waitFor(result).toBeVisible().withTimeout(240000);
    const attributes = await result.getAttributes();
    const summary = attributes.label || attributes.text;
    if (summary.startsWith('HealthKit Simulator probe failed')) throw new Error(summary);
    jestExpect(summary).toContain('authorizationPlan=feature-scoped');
    jestExpect(summary).toContain('writeTypes=0');
    jestExpect(summary).toContain('sampleTypes=passed');
    jestExpect(summary).toContain('syntheticSteps=passed');
    jestExpect(summary).toContain('unrelatedSleep=passed');
    jestExpect(summary).toContain('emptyQuery=completed');
    jestExpect(summary).toContain('realSamples=unverified');
    jestExpect(summary).toMatch(/availability=(available|unavailable)/);
    console.log('HEALTHKIT_SIMULATOR ' + summary);
  });
});
