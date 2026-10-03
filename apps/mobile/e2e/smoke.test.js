/* global by, device, element */

describe('Orot mobile app', () => {
  beforeAll(async () => {
    await device.launchApp({
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });
  });

  it('launches in English and still renders the Korean welcome screen', async () => {
    await expect(element(by.id('welcome-title'))).toHaveText(
      'Orot에 오신 걸 환영해요',
    );
    await expect(element(by.id('get-started'))).toHaveLabel('시작하기');
    await expect(element(by.id('open-appointments'))).toHaveLabel('예약');
  });
});
