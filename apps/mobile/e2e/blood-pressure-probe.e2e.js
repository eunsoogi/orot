/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('Blood-pressure import on a dedicated iOS Simulator', () => {
  it('opens the BP flow and displays persisted synthetic components and source status', async () => {
    const metroPort = process.env.OROT_BLOOD_PRESSURE_METRO_PORT || '8218';
    const launchArgs = { RCT_jsLocation: `localhost:${metroPort}` };
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({ newInstance: false, launchArgs });
    await device.disableSynchronization();

    await waitFor(element(by.id('welcome-title')))
      .toHaveText('Orot에 오신 걸 환영해요')
      .withTimeout(30000);
    await element(by.id('open-blood-pressure-import')).tap();
    await waitFor(element(by.id('blood-pressure-title')))
      .toHaveText('혈압 기록')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-empty')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('blood-pressure-import')).tap();

    await waitFor(element(by.id('blood-pressure-reading-systolic-0-value')))
      .toHaveText('수축기 120 mmHg')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-reading-diastolic-0-value')))
      .toHaveText('이완기 80 mmHg')
      .withTimeout(30000);
    expectText(
      await readText(element(by.id('blood-pressure-reading-systolic-0-time'))),
      /^측정 시각: \d{4}-\d\d-\d\dT/u,
    );
    expectText(
      await readText(
        element(by.id('blood-pressure-reading-systolic-0-source')),
      ),
      '출처: Synthetic HealthKit probe',
    );
    expectText(
      await readText(
        element(by.id('blood-pressure-reading-systolic-0-original')),
      ),
      '원본 정보 제공 안 됨',
    );
    expectText(
      await readText(
        element(by.id('blood-pressure-reading-diastolic-0-original')),
      ),
      '원본 정보 제공 안 됨',
    );
    expectText(
      await readText(element(by.id('blood-pressure-read-authorization'))),
      'HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.',
    );
    expectText(
      await readText(element(by.id('blood-pressure-status'))),
      '혈압 기록 변경을 가져왔어요.',
    );
    await device.takeScreenshot('blood-pressure-user-visible-import-result');

    console.log(
      'BLOOD_PRESSURE_UI_RESULT syntheticFixture=used; sqlCipher=available; ' +
        'productionQuery=notRun; productionSamples=unverified; ' +
        'systolicDiastolic=visible; sourceTime=visible; ' +
        'originalDisplayUnit=explicitlyUnavailable; ' +
        'readAuthorization=notObservable; healthStoreWrites=none',
    );
  });
});

async function readText(target) {
  const attributes = await target.getAttributes();
  return attributes.text ?? attributes.label ?? '';
}

function expectText(actual, expected) {
  if (expected instanceof RegExp) jestExpect(actual).toMatch(expected);
  else jestExpect(actual).toBe(expected);
}
