/* global by, device, element, expect, waitFor, describe, it, beforeAll */

describe('Calendar appointment confirmation with a synthetic-only provider', () => {
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

    await expect(element(by.id('welcome-title'))).toHaveText(
      'Orot에 오신 걸 환영해요',
    );
    await expect(element(by.id('calendar-connect'))).not.toExist();
    await element(by.id('open-appointments')).tap();

    await waitFor(element(by.id('calendar-connect')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('appointment-add'))).not.toExist();
    await element(by.id('calendar-connect')).tap();

    const selectedEvent = element(
      by.id('calendar-candidate-calendar-synthetic-clinic'),
    );
    await waitFor(selectedEvent).toBeVisible().withTimeout(30000);
    await element(by.id('calendar-candidate-calendar-synthetic-clinic')).tap();
    await expect(element(by.id('calendar-selection'))).toBeVisible();
    await expect(element(by.id('calendar-confirm-selected'))).toBeVisible();

    await element(by.id('calendar-confirm-selected')).tap();
    await waitFor(element(by.id('calendar-next-visit-title')))
      .toHaveText('합성 외래 방문')
      .withTimeout(30000);
    await expect(element(by.id('calendar-next-visit-time'))).toHaveText(
      '2035년 6월 2일 09:00–10:00 · Asia/Seoul',
    );
    await expect(element(by.text('팀 회의 테스트 데이터'))).not.toExist();
  });
});
