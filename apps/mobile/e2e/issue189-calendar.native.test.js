/* global by, device, element, waitFor, expect */
const { expect: jestExpect } = require('@jest/globals');
const { tapNativeNavigationAction } = require('./smokeHelpers');

describe('issue 189 actual Apple calendar import with synthetic sources', () => {
  it('classifies all three events and imports one medical occurrence without duplicating it', async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await waitFor(element(by.id('home-open-schedule')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('home-open-schedule')).tap();
    await waitFor(element(by.id('open-medical-appointments')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('open-medical-appointments')).tap();
    const action = element(by.id('medical-appointment-import'));
    await waitFor(action).toBeVisible().withTimeout(30000);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await action.tap();
      // Wait for this run to clear the previous result before observing its completion.
      await waitFor(element(by.text('진료 일정 1건을 가져왔어요.')))
        .not.toExist()
        .withTimeout(10000);
      await waitFor(element(by.text('진료 일정 1건을 가져왔어요.')))
        .toBeVisible()
        .withTimeout(120000);
      const coverage = await element(
        by.text('일정 3건 · 분류 완료'),
      ).getAttributes();
      jestExpect(coverage.label || coverage.text).toBe('일정 3건 · 분류 완료');
      await expect(
        element(by.id('medical-appointment-details-calendar-candidate-1')),
      ).toExist();
      await expect(
        element(by.id('medical-appointment-details-calendar-candidate-2')),
      ).not.toExist();
      await expect(
        element(by.id('medical-appointment-details-calendar-candidate-3')),
      ).not.toExist();
      console.log(
        'ISSUE189_CALENDAR_AUTO_IMPORT ' +
          JSON.stringify({
            attempt,
            classified: 3,
            imported: 1,
            provider: 'actual Apple',
            source: 'synthetic calendar',
          }),
      );
    }
    await element(
      by.id('medical-appointment-details-calendar-candidate-1'),
    ).tap();
    await expect(element(by.text('불확실성: 낮음'))).toExist();
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('schedule-open-appointments')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('schedule-open-appointments')).tap();
    await waitFor(
      element(by.id('appointment-edit-issue189-synthetic-appointment-1')),
    )
      .toExist()
      .withTimeout(10000);
    await expect(
      element(by.id('appointment-edit-issue189-synthetic-appointment-2')),
    ).not.toExist();
    console.log(
      'ISSUE189_CALENDAR_DEDUPLICATION ' +
        JSON.stringify({
          imports: 2,
          storedOccurrences: 1,
          repository: 'synthetic session repository',
        }),
    );
  });
});
