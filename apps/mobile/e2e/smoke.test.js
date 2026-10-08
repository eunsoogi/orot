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

    // Exercise the Korean home entry and return path before the Calendar probe.
    await element(by.id('open-ai-features')).tap();
    await waitFor(element(by.id('ai-features-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('질환 가능성 살펴보기'))).toExist();
    await expect(element(by.text('건강 기록과 대화하기'))).toExist();
    await expect(element(by.text('의료 자료 찾아보기'))).toExist();
    await expect(element(by.id('visit-questions-unavailable'))).toHaveText(
      '현재 진료 질문을 준비할 수 없어요.',
    );
    await element(by.id('ai-features-screen')).scrollTo('bottom', 0.5, 0.7);
    await expect(element(by.id('ai-feature-external-evidence'))).toBeVisible();
    await element(by.id('ai-feature-back')).tap();
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

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
