/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('HealthKit sleep import on iOS Simulator', () => {
  it('normalizes synthetic sleep data and keeps absent days explicit', async () => {
    // The Debug build embeds the probe entry; a Metro override would load the app's default entry.
    await device.launchApp();
    const result = element(by.id('sleep-import-probe-result'));
    await waitFor(result).toBeVisible().withTimeout(240000);
    const attributes = await result.getAttributes();
    const summary = attributes.label || attributes.text;
    if (summary.startsWith('Sleep import Simulator probe failed'))
      throw new Error(summary);
    jestExpect(summary).toContain('stage=asleepUnspecified');
    jestExpect(summary).toContain('midnightSplit=passed');
    jestExpect(summary).toContain('noData=preserved');
    jestExpect(summary).toContain('anchorResume=passed');
    jestExpect(summary).toContain('anchoredNormalization=passed');
    jestExpect(summary).toContain('readAuthorization=notObservable');
    jestExpect(summary).toContain('source=synthetic');
    jestExpect(summary).toContain('realSamples=unverified');
    jestExpect(summary).toMatch(/availability=(available|unavailable)/);
    jestExpect(summary).toMatch(/sleepAuthorization=(completed|notRequested)/);
    console.log('HEALTHKIT_SLEEP_SIMULATOR ' + summary);
  });
});
