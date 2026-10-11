/* global by, device, element, waitFor */
const { expect: jestExpect } = require('@jest/globals');
const { tapNativeNavigationAction } = require('./smokeHelpers');

describe('issue 189 actual UI with synthetic calendar and health data', () => {
  it('scrolls paged health records and completes a native back swipe', async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    const records = element(by.id('navigation-tab-records'));
    await waitFor(records).toExist().withTimeout(30000);
    await tapNativeNavigationAction('navigation-tab-records');
    const library = element(by.id('records-open-health-library'));
    await waitFor(library).toBeVisible().withTimeout(30000);
    await library.tap();
    const list = element(by.id('health-records-scroll'));
    await waitFor(element(by.id('health-record-row-0')))
      .toBeVisible()
      .withTimeout(30000);
    // The fixture contains 1,503 rows. Reaching row 55 requires a second page.
    await waitFor(element(by.id('health-record-row-55')))
      .toBeVisible()
      .whileElement(by.id('health-records-scroll'))
      .scroll(300, 'down', 0.5, 0.5);
    const row = await element(
      by.id('health-record-row-55-value'),
    ).getAttributes();
    jestExpect(row.label || row.text).toBe('85 count/min');
    console.log(
      'ISSUE189_HEALTH_PAGE_RESULT ' +
        JSON.stringify({ row: 55, value: row.label || row.text }),
    );
    await list.swipe('right', 'slow', 0.1, 0.01, 0.5);
    await waitFor(list).toBeVisible().withTimeout(10000);
    await waitFor(library).not.toBeVisible().withTimeout(10000);
    console.log('ISSUE189_SHORT_SWIPE_RESULT route-preserved');
    await list.swipe('right', 'slow', 0.9, 0.01, 0.5);
    await waitFor(library).toBeVisible().withTimeout(10000);
    await waitFor(list).not.toExist().withTimeout(10000);
    console.log('ISSUE189_NATIVE_SWIPE_RESULT completed');
  });
});
