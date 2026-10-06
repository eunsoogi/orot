/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('Blood-pressure import on a dedicated iOS Simulator', () => {
  it('reopens persisted synthetic components and keeps the anchored replay idempotent', async () => {
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
    const systolicTime = await readText(
      element(by.id('blood-pressure-reading-systolic-0-time')),
    );
    const diastolicTime = await readText(
      element(by.id('blood-pressure-reading-diastolic-0-time')),
    );
    expectText(systolicTime, /^측정 시각: \d{4}-\d\d-\d\dT/u);
    expectText(diastolicTime, systolicTime);
    expectText(
      await readText(
        element(by.id('blood-pressure-reading-systolic-0-source')),
      ),
      '출처: Synthetic HealthKit probe',
    );
    expectText(
      await readText(
        element(by.id('blood-pressure-reading-diastolic-0-source')),
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
    await waitFor(element(by.id('blood-pressure-probe-storage')))
      .toHaveText('sqlCipher=available; rows=2; cursor=fixture-anchor')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-probe-sync')))
      .toHaveText(
        'status=completed; upserted=2; deleted=0; cursorAdvanced=true',
      )
      .withTimeout(30000);
    await device.takeScreenshot('blood-pressure-user-visible-import-result');

    // Killing the app process forces SQLCipher and its repository to reopen on launch.
    await device.terminateApp();
    await device.launchApp({ newInstance: false, launchArgs });
    await device.disableSynchronization();
    await waitFor(element(by.id('welcome-title')))
      .toHaveText('Orot에 오신 걸 환영해요')
      .withTimeout(30000);
    await element(by.id('open-blood-pressure-import')).tap();
    await waitFor(element(by.id('blood-pressure-title')))
      .toHaveText('혈압 기록')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-reading-systolic-0-value')))
      .toHaveText('수축기 120 mmHg')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-reading-diastolic-0-value')))
      .toHaveText('이완기 80 mmHg')
      .withTimeout(30000);
    expectText(
      await readText(element(by.id('blood-pressure-reading-systolic-0-time'))),
      systolicTime,
    );
    expectText(
      await readText(element(by.id('blood-pressure-reading-diastolic-0-time'))),
      diastolicTime,
    );
    expectText(
      await readText(
        element(by.id('blood-pressure-reading-systolic-0-source')),
      ),
      '출처: Synthetic HealthKit probe',
    );
    expectText(
      await readText(
        element(by.id('blood-pressure-reading-diastolic-0-source')),
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
    await waitFor(element(by.id('blood-pressure-probe-storage')))
      .toHaveText('sqlCipher=available; rows=2; cursor=fixture-anchor')
      .withTimeout(30000);

    await element(by.id('blood-pressure-import')).tap();
    await waitFor(element(by.id('blood-pressure-status')))
      .toHaveText('새로운 혈압 기록 변경이 없어요.')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-probe-sync')))
      .toHaveText(
        'status=completed; upserted=0; deleted=0; cursorAdvanced=false',
      )
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-probe-storage')))
      .toHaveText('sqlCipher=available; rows=2; cursor=fixture-anchor')
      .withTimeout(30000);
    await device.takeScreenshot('blood-pressure-reopened-replay-result');

    console.log(
      'BLOOD_PRESSURE_RESTART_RESULT syntheticFixture=used; sqlCipher=available; ' +
        'productionQuery=notRun; productionSamples=unverified; rowsAfterRestart=2; ' +
        'fixtureCursorPersisted=true; replayUpserted=0; replayCursorAdvanced=false; ' +
        'systolicDiastolic=visible; sourceTimeStable=true; ' +
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
