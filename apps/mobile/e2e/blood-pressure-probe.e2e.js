/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('Blood-pressure import on a dedicated iOS Simulator', () => {
  it('verifies synthetic correlations without reading the production HealthKit store', async () => {
    const metroPort = process.env.OROT_BLOOD_PRESSURE_METRO_PORT || '8218';
    await device.launchApp({
      launchArgs: { RCT_jsLocation: `localhost:${metroPort}` },
    });

    // The React Native debug loop stays awake after the probe renders; skip idle monitoring while reading its terminal result.
    await device.disableSynchronization();
    const result = element(by.id('blood-pressure-probe-result'));
    // Detox uses a full-string native regex match, so verify every synthetic result field, including any line breaks.
    await waitFor(result)
      .toHaveText(
        /^(?:healthStoreAvailability=available;[\s\S]*productionQuery=notRun;[\s\S]*productionSamples=unverified;[\s\S]*productionValues=withheld;[\s\S]*syntheticCorrelation=passed;[\s\S]*systolicDiastolicMapping=passed;[\s\S]*syntheticReadAuthorization=notObservable;[\s\S]*healthStoreWrites=none|Blood-pressure Simulator probe failed; details are withheld)$/,
      )
      .withTimeout(30000);
    const attributes = await result.getAttributes();
    const summary = attributes.text ?? attributes.label ?? '';
    jestExpect(attributes.identifier).toBe('blood-pressure-probe-result');
    console.log(
      'BLOOD_PRESSURE_ACCESSIBILITY ' +
        JSON.stringify({
          identifier: attributes.identifier,
          label: attributes.label,
          text: attributes.text,
        }),
    );
    if (summary.startsWith('Blood-pressure Simulator probe failed'))
      throw new Error(summary);

    const productionState = /healthStoreAvailability=available;/.exec(summary);
    jestExpect(productionState).not.toBeNull();
    if (!productionState)
      throw new Error('The production query state was not reported.');
    jestExpect(summary).toContain('productionValues=withheld');
    jestExpect(summary).toContain('productionSamples=unverified');
    jestExpect(summary).toContain('syntheticCorrelation=passed');
    jestExpect(summary).toContain('systolicDiastolicMapping=passed');
    jestExpect(summary).toContain('syntheticReadAuthorization=notObservable');
    jestExpect(summary).toContain('healthStoreWrites=none');
    console.log('BLOOD_PRESSURE_SIMULATOR ' + summary);
  });
});
