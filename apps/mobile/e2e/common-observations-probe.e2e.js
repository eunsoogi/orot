/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('common HealthKit observations on iOS Simulator', () => {
  it('imports synthetic observations into encrypted storage and replays idempotently', async () => {
    const metroPort = process.env.RCT_METRO_PORT || '8220';
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({
      newInstance: false,
      launchArgs: { RCT_jsLocation: `localhost:${metroPort}` },
    });
    await element(by.id('open-common-observations')).tap();
    await element(by.id('common-observations-toggle-heartRate')).tap();
    await element(by.id('common-observations-toggle-steps')).tap();
    await element(by.id('common-observations-toggle-bodyMass')).tap();
    await element(by.id('common-observations-import')).tap();

    const status = element(by.id('common-observations-status'));
    await waitFor(status).toBeVisible().withTimeout(240000);
    const statusAttributes = await status.getAttributes();
    const statusText = statusAttributes.label || statusAttributes.text;
    jestExpect(statusText).toContain(
      '선택한 기록의 변경을 가져왔어요. 2개 저장, 0개 삭제, 0개 미지원',
    );
    const attributes = await element(
      by.id('common-observations-probe-summary'),
    ).getAttributes();
    const summary = attributes.label || attributes.text;
    jestExpect(summary).toContain('initial=complete:2:0:0:cursor=true');
    jestExpect(summary).toContain('heartRate=72 count/min');
    jestExpect(summary).toContain('steps=1200 count');
    jestExpect(summary).toContain('bodyMass=empty');
    jestExpect(summary).toContain('readAuthorization=notObservable');
    jestExpect(summary).toContain('replay=empty:0:0:cursor=false');
    jestExpect(summary).toContain('records=2');
    jestExpect(summary).toContain('availability=available');
    jestExpect(summary).toContain('writeTypes=0');
    jestExpect(summary).toContain('storage=encrypted-local');
    jestExpect(summary).toContain('replayIdempotent=true');
    console.log('COMMON_OBSERVATIONS_SIMULATOR ' + summary);
  });
});
