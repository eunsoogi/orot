/* global by, device, element, expect, waitFor, describe, it, beforeAll */

const { tapNativeNavigationAction } = require('./smokeHelpers');

describe('Schedule appointment confirmation with a synthetic-only provider', () => {
  beforeAll(async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
  });

  it('stores only the explicitly selected synthetic event after confirmation', async () => {
    await device.launchApp({
      newInstance: false,
      launchArgs: { OROT_CALENDAR_PROBE: 'synthetic' },
    });

    await expect(element(by.id('welcome-title'))).toHaveText('오롯');
    await expect(element(by.id('calendar-connect'))).not.toExist();
    await tapNativeNavigationAction('navigation-tab-schedule');

    await waitFor(element(by.id('calendar-title')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('calendar-title'))).toHaveText('일정');
    await expect(element(by.id('calendar-connect'))).toBeVisible();
    // The Schedule tab owns safe-area handling inside the shared native route scene.
    const routeScene = await element(
      by.id('navigation-route-scene-route-1'),
    ).getAttributes();
    const calendarScroll = await element(
      by.id('calendar-screen'),
    ).getAttributes();
    const calendarTitle = await element(
      by.id('calendar-title'),
    ).getAttributes();
    for (const [description, attributes] of [
      ['calendar scroll', calendarScroll],
      ['calendar title', calendarTitle],
    ]) {
      if (!attributes.frame || !routeScene.frame) {
        throw new Error(`Missing safe-area frame for ${description}.`);
      }
      if (attributes.frame.y - routeScene.frame.y < 44) {
        throw new Error(`${description} overlaps the top system safe area.`);
      }
    }
    await device.takeScreenshot('calendar-top-safe-area');
    await expect(element(by.id('appointment-add'))).not.toExist();
    await element(by.id('calendar-connect')).tap();

    // Start within the visible viewport, away from the floating native action bar.
    await element(by.id('calendar-screen')).scrollTo('bottom', 0.5, 0.5);
    await waitFor(element(by.id('calendar-month-title')))
      .toHaveText('2035년 6월')
      .withTimeout(30000);
    await expect(element(by.id('calendar-day-2035-06-02'))).toHaveLabel(
      '2035년 6월 2일, 합성 외래 방문',
    );
    // This bridge supplies synthetic appointments so the visual check never reads a personal calendar.
    await device.takeScreenshot('calendar-seven-column-grid-dark');
    await element(by.id('calendar-day-2035-06-02')).tap();

    const selectedEvent = element(
      by.id('calendar-candidate-calendar-synthetic-clinic'),
    );
    await waitFor(selectedEvent).toBeVisible().withTimeout(30000);
    await expect(
      element(by.id('calendar-candidate-calendar-synthetic-unrelated')),
    ).not.toExist();
    await element(by.id('calendar-candidate-calendar-synthetic-clinic')).tap();
    // The native hierarchy shows the confirmation CTA while Detox still reports
    // an awake main run loop, so use visible-state checks for this short flow.
    await device.disableSynchronization();
    try {
      await waitFor(element(by.id('calendar-confirm-selected')))
        .toBeVisible()
        .withTimeout(30000);
      await element(by.id('calendar-confirm-selected')).tap();
      await waitFor(element(by.id('calendar-confirm-selected')))
        .not.toExist()
        .withTimeout(30000);
      await element(by.id('calendar-screen')).scrollTo('bottom', 0.5, 0.5);
      await waitFor(element(by.id('calendar-next-visit-title')))
        .toHaveText('합성 외래 방문')
        .withTimeout(30000);
      await device.takeScreenshot('calendar-selected-appointment-dark');
      await expect(element(by.id('calendar-next-visit-time'))).toHaveText(
        '2035년 6월 2일 09:00–10:00 · Asia/Seoul',
      );
    } finally {
      await device.enableSynchronization();
    }
  });
});
