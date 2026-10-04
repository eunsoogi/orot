/* global by, device, element, waitFor */

describe('Orot mobile app', () => {
  beforeAll(async () => {
    await device.launchApp({
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });
  });

  it('renders the Korean welcome screen and opens appointments in English', async () => {
    await expect(element(by.id('welcome-title'))).toHaveText(
      'Orot에 오신 걸 환영해요',
    );
    await expect(element(by.id('get-started'))).toHaveLabel('시작하기');
    await expect(element(by.id('open-appointments'))).toHaveLabel('예약');
    await element(by.id('open-appointments')).tap();
    await waitFor(element(by.id('appointments-title')))
      .toHaveText('예약')
      .withTimeout(30000);
    await expect(element(by.id('appointment-add'))).toBeVisible();
  });
});
