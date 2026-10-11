/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');
const { tapNativeNavigationAction } = require('./smokeHelpers');

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
      .toHaveText('오롯')
      .withTimeout(30000);
    await openBloodPressureFromRecords();
    expectText(
      await readText(element(by.id('blood-pressure-read-authorization'))),
      'HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.',
    );
    await element(by.id('blood-pressure-import')).tap();

    await waitFor(element(by.id('blood-pressure-result-saved-count')))
      .toHaveText('2개')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-result-deleted-count')))
      .toHaveText('0개')
      .withTimeout(30000);
    expectText(
      await readText(element(by.id('blood-pressure-status'))),
      '가져오기가 끝났어요',
    );
    // The probe uses synthetic rows and verifies a count summary, not real HealthKit access.
    await device.takeScreenshot('blood-pressure-import-completion-result');

    await element(by.id('blood-pressure-open-library')).tap();
    await waitFor(element(by.id('health-records-title')))
      .toHaveText('건강 기록')
      .withTimeout(30000);
    await waitFor(element(by.id('health-record-row-0-concept')))
      .toHaveText('이완기')
      .withTimeout(30000);
    await waitFor(element(by.id('health-record-row-0-value')))
      .toHaveText('80 mmHg')
      .withTimeout(30000);
    await waitFor(element(by.id('health-record-row-1-concept')))
      .toHaveText('수축기')
      .withTimeout(30000);
    await waitFor(element(by.id('health-record-row-1-value')))
      .toHaveText('120 mmHg')
      .withTimeout(30000);
    const systolicTime = await readText(
      element(by.id('health-record-row-1-time')),
    );
    const diastolicTime = await readText(
      element(by.id('health-record-row-0-time')),
    );
    expectText(systolicTime, /^측정 시각: \d{4}-\d\d-\d\dT/u);
    expectText(diastolicTime, systolicTime);
    await waitFor(element(by.id('blood-pressure-probe-storage')))
      .toHaveText('sqlCipher=available; rows=2; cursor=fixture-anchor')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-probe-sync')))
      .toHaveText(
        'status=completed; upserted=2; deleted=0; cursorAdvanced=true',
      )
      .withTimeout(30000);
    await device.takeScreenshot('blood-pressure-import-health-records-library');

    // Killing the app process forces SQLCipher and its repository to reopen on launch.
    await device.terminateApp();
    await device.launchApp({ newInstance: false, launchArgs });
    await device.disableSynchronization();
    await waitFor(element(by.id('welcome-title')))
      .toHaveText('오롯')
      .withTimeout(30000);
    await openBloodPressureFromRecords();
    await element(by.id('blood-pressure-import')).tap();
    await waitFor(element(by.id('blood-pressure-status')))
      .toHaveText('새로 반영된 기록이 없어요')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-probe-sync')))
      .toHaveText(
        'status=completed; upserted=0; deleted=0; cursorAdvanced=false',
      )
      .withTimeout(30000);
    await device.takeScreenshot('blood-pressure-reopened-empty-import-result');
    await element(by.id('blood-pressure-open-library')).tap();
    await waitFor(element(by.id('health-records-title')))
      .toHaveText('건강 기록')
      .withTimeout(30000);
    await waitFor(element(by.id('health-record-row-0-concept')))
      .toHaveText('이완기')
      .withTimeout(30000);
    await waitFor(element(by.id('health-record-row-0-value')))
      .toHaveText('80 mmHg')
      .withTimeout(30000);
    await waitFor(element(by.id('health-record-row-1-concept')))
      .toHaveText('수축기')
      .withTimeout(30000);
    await waitFor(element(by.id('health-record-row-1-value')))
      .toHaveText('120 mmHg')
      .withTimeout(30000);
    expectText(
      await readText(element(by.id('health-record-row-1-time'))),
      systolicTime,
    );
    expectText(
      await readText(element(by.id('health-record-row-0-time'))),
      diastolicTime,
    );
    await waitFor(element(by.id('blood-pressure-probe-storage')))
      .toHaveText('sqlCipher=available; rows=2; cursor=fixture-anchor')
      .withTimeout(30000);
    await device.takeScreenshot(
      'blood-pressure-reopened-health-records-library',
    );

    console.log(
      'BLOOD_PRESSURE_RESTART_RESULT syntheticFixture=used; sqlCipher=available; ' +
        'productionQuery=notRun; productionSamples=unverified; rowsAfterRestart=2; ' +
        'fixtureCursorPersisted=true; replayUpserted=0; replayCursorAdvanced=false; ' +
        'systolicDiastolic=visibleInLibrary; sourceTimeStable=true; ' +
        'sourceMetadataHiddenFromUserView=true; ' +
        'readAuthorization=notObservable; healthStoreWrites=none',
    );
  });
});

async function openBloodPressureFromRecords() {
  // Follow the same Records tab and row that a user sees in the app.
  await tapNativeNavigationAction('navigation-tab-records');
  await waitFor(element(by.id('records-title')))
    .toBeVisible()
    .withTimeout(30000);
  await element(by.id('records-open-blood-pressure')).tap();
  await waitFor(element(by.id('blood-pressure-title')))
    .toHaveText('혈압 기록')
    .withTimeout(30000);
}

async function readText(target) {
  const attributes = await target.getAttributes();
  return attributes.text ?? attributes.label ?? '';
}

function expectText(actual, expected) {
  if (expected instanceof RegExp) jestExpect(actual).toMatch(expected);
  else jestExpect(actual).toBe(expected);
}
