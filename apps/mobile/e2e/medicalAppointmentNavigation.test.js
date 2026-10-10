/* global by, device, element, waitFor, describe, it */

describe('issue 108 App navigation on iOS Simulator', () => {
  it('opens the manual page and returns through classification to Home', async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
      launchArgs: {
        OROT_E2E_PROBE: 'medical-appointment-app-navigation',
      },
    });

    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('navigation-route-scroll')).scrollTo('bottom');
    await waitFor(element(by.id('open-medical-appointments')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('open-medical-appointments')).tap();
    // This privacy notice appears only after App resolves the injected saved provider.
    await waitFor(
      element(
        by.text(
          '선택한 온디바이스 모델은 일정 제목과 시간을 기기에서 처리합니다.',
        ),
      ),
    )
      .toBeVisible()
      .withTimeout(30000);
    await waitFor(element(by.id('medical-appointment-manual')))
      .toBeVisible()
      .withTimeout(30000);

    await element(by.id('medical-appointment-manual')).tap();
    await waitFor(element(by.id('appointment-add')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('appointments-back')).tap();
    await waitFor(element(by.id('medical-appointment-manual')))
      .toBeVisible()
      .withTimeout(30000);

    await element(by.id('navigation-back')).tap();
    await waitFor(element(by.id('navigation-route-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('navigation-route-scroll')).scrollTo('top');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    console.log(
      'ISSUE_108_APP_NAVIGATION_SIMULATOR: HomeToClassification=verified; classificationToManual=verified; manualToClassification=verified; classificationToHome=verified; savedSelection=synthetic; inference=not-run; realProvider=unverified',
    );
    await device.terminateApp();
  });
});
