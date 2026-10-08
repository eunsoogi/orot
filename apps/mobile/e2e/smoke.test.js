/* global by, device, element, waitFor */

describe('Orot mobile app', () => {
  beforeAll(async () => {
    await device.launchApp({
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });
  });

  it('renders the Korean welcome screen in English and opens Calendar linking', async () => {
    await expect(element(by.id('welcome-title'))).toHaveText(
      'Orot에 오신 걸 환영해요',
    );
    await expect(element(by.id('open-ai-features'))).toHaveLabel(
      'AI 건강 기능 살펴보기',
    );
    await expect(element(by.id('open-appointments'))).toHaveLabel('예약');
    await element(by.id('open-appointments')).tap();
    // Manual appointment CRUD remains isolated in the dedicated appointments probe.
    await waitFor(element(by.id('calendar-title')))
      .toHaveText('캘린더 연결')
      .withTimeout(30000);
    await expect(element(by.id('calendar-connect'))).toHaveLabel(
      '캘린더 일정 불러오기',
    );
  });
});
