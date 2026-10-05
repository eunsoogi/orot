/* global by, device, element, waitFor */

describe('Orot mobile app', () => {
  beforeAll(async () => {
    await device.launchApp({
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });
  });

  it('launches in English and opens Korean Calendar linking from the welcome screen', async () => {
    await expect(element(by.id('welcome-title'))).toHaveText(
      'Orot에 오신 걸 환영해요',
    );
    await expect(element(by.id('get-started'))).toHaveLabel('시작하기');
    await expect(element(by.id('open-appointments'))).toHaveLabel('예약');
    await element(by.id('open-appointments')).tap();
    // Appointment CRUD remains in the dedicated appointments probe.
    await waitFor(element(by.id('calendar-title')))
      .toHaveText('캘린더 연결')
      .withTimeout(30000);
    await expect(element(by.id('calendar-connect'))).toHaveLabel(
      '캘린더 일정 불러오기',
    );
  });
});
