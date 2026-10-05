/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('common HealthKit observations on iOS Simulator', () => {
  it('queries and maps feature-scoped synthetic observations without saving', async () => {
    const metroPort = process.env.RCT_METRO_PORT || '8220';
    await device.launchApp({
      launchArgs: { RCT_jsLocation: `localhost:${metroPort}` },
    });
    await element(by.id('common-observations-toggle-heartRate')).tap();
    await element(by.id('common-observations-toggle-steps')).tap();
    await element(by.id('common-observations-toggle-bodyMass')).tap();
    await element(by.id('common-observations-import')).tap();

    const status = element(by.id('common-observations-status'));
    await waitFor(status).toBeVisible().withTimeout(240000);
    const statusAttributes = await status.getAttributes();
    const statusText = statusAttributes.label || statusAttributes.text;
    jestExpect(statusText).toContain(
      '조회와 변환을 마쳤어요. 2개 관측값을 확인했어요.',
    );
    const attributes = await element(
      by.id('common-observations-probe-summary'),
    ).getAttributes();
    const summary = attributes.label || attributes.text;
    jestExpect(summary).toContain(
      'heartRate=mapped:1:count/min:com.orot.healthkit.synthetic:synthetic-heart-rate:2026-10-01T00:00:00.000Z/2026-10-06T00:00:00.000Z',
    );
    jestExpect(summary).toContain(
      'steps=mapped:1:count:com.orot.healthkit.synthetic:synthetic-steps:2026-10-01T00:00:00.000Z/2026-10-06T00:00:00.000Z',
    );
    jestExpect(summary).toContain(
      'bodyMass=empty:authorization=completed:notObservable',
    );
    jestExpect(summary).toContain('stepAggregation=safe:1200');
    jestExpect(summary).toContain('availability=available');
    jestExpect(summary).toContain('writeTypes=0');
    jestExpect(summary).toContain('storage=not-performed');
    console.log('COMMON_OBSERVATIONS_SIMULATOR ' + summary);
  });
});
