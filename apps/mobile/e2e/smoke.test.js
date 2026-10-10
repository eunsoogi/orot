/* global by, device, element, waitFor */

const {
  confirmUnsavedLeave,
  openFeatureAndReturn,
  scrollHomeActionIntoView,
  tapNativeNavigationAction,
} = require('./smokeHelpers');

describe('Orot mobile app', () => {
  beforeAll(async () => {
    // Detox reinstalls between spec files, but iOS keeps Keychain items after app uninstall.
    await device.clearKeychain();
    await device.launchApp({
      languageAndLocale: { language: 'en', locale: 'en_US' },
      // The normal app route opts into sanitized logs so repository-open CI failures retain their cause.
      launchArgs: { OROT_STORAGE_DIAGNOSTICS: 'enabled' },
    });
  });

  it('renders the Korean welcome screen in English and opens Calendar linking', async () => {
    await expect(element(by.id('welcome-title'))).toHaveText('오롯');
    await expect(element(by.text('다음 진료 질문'))).toExist();
    await expect(element(by.text('질환 가능성 살펴보기'))).toExist();
    await expect(element(by.text('건강 기록과 대화하기'))).toExist();
    await expect(element(by.text('의료 자료 찾아보기'))).toExist();
    await expect(element(by.id('open-appointments'))).toHaveLabel('예약');

    // The bottom core action remains independently reachable from the home cards.
    await expect(element(by.id('navigation-recording'))).toHaveLabel(
      '녹음 화면으로 이동',
    );
    await tapNativeNavigationAction('navigation-recording');
    await waitFor(element(by.id('recording-controls-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    // Start above the fixed toolbar overlay while scrolling expanded consent copy.
    await element(by.id('recording-controls-scroll')).scrollTo(
      'bottom',
      0.5,
      0.5,
    );
    await waitFor(element(by.id('recording-start')))
      .toBeVisible()
      .withTimeout(30000);
    // Exercise the native Home control before checking edge-swipe back.
    await tapNativeNavigationAction('navigation-home');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await tapNativeNavigationAction('navigation-recording');
    await waitFor(element(by.id('recording-controls-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    // Keep the gesture inside the visible scroll viewport above the toolbar.
    await element(by.id('recording-controls-scroll')).scrollTo(
      'bottom',
      0.5,
      0.5,
    );
    await waitFor(element(by.id('recording-start')))
      .toBeVisible()
      .withTimeout(30000);
    // Start within the app's left-edge guard to verify its real back gesture.
    await element(by.id('edge-swipe-back-region')).swipe(
      'right',
      'slow',
      0.8,
      0.02,
      0.5,
    );
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    // Each home card opens its feature directly without starting inference.
    // Accessibility text can move the first card below the initial scroll viewport.
    await element(by.id('navigation-route-scroll')).scroll(
      240,
      'down',
      0.5,
      0.7,
    );
    await element(by.id('ai-feature-visit-questions')).tap();
    await waitFor(element(by.id('next-visit-questions-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('next-visit-appointment'))).toExist();
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    await openFeatureAndReturn(
      'ai-feature-disease-hypotheses',
      'disease-hypotheses-screen',
      async () => {
        // Keychain is cleared above, so the real app must show a recoverable error before inference.
        await element(by.id('disease-hypotheses-generate')).tap();
        await waitFor(
          element(
            by.text('가능성을 정리하지 못했어요. 잠시 후 다시 시도해 주세요.'),
          ),
        )
          .toBeVisible()
          .withTimeout(30000);
        await expect(
          element(by.id('inference-disclosure-sheet')),
        ).not.toExist();
      },
    );

    await openFeatureAndReturn(
      'ai-feature-rag-conversation',
      'rag-conversation-screen',
      async () => {
        // Component tests cover disabled state because Detox reports enabled=true for disabled React Native Buttons here.
        await expect(element(by.id('rag-conversation-send'))).toBeVisible();
        // A non-personal probe exercises the real route without selecting or contacting a provider.
        await element(by.id('rag-conversation-input')).typeText(
          'orot-no-provider-check',
        );
        await element(by.id('rag-conversation-input')).tapReturnKey();
        await element(by.id('rag-conversation-send')).tap();
        await waitFor(
          element(
            by.text('답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'),
          ),
        )
          .toBeVisible()
          .withTimeout(30000);
        await expect(
          element(by.id('inference-disclosure-sheet')),
        ).not.toExist();
      },
      true,
    );

    // The final AI card starts below the shared scroll viewport after route returns.
    await element(by.id('navigation-route-scroll')).scroll(
      240,
      'down',
      0.5,
      0.7,
    );
    await element(by.id('ai-feature-external-evidence')).tap();
    await waitFor(element(by.id('external-medical-evidence-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('external-evidence-query'))).toBeVisible();
    await expect(element(by.id('external-evidence-consent'))).toBeVisible();
    // Use the consent guidance as the route-level boundary; this Detox surface reports disabled Buttons as enabled.
    await element(by.id('external-evidence-query')).typeText(
      'orot-consent-check',
    );
    await element(by.id('external-evidence-query')).tapReturnKey();
    await expect(
      element(by.text('검색어 전송에 동의한 뒤 검색할 수 있어요.')),
    ).toBeVisible();
    await element(by.id('external-evidence-consent')).tap();
    await expect(
      element(by.text('검색어 전송에 동의한 뒤 검색할 수 있어요.')),
    ).not.toExist();
    // Do not press search: this route check must not make a real literature request.
    await element(by.id('external-medical-evidence-screen')).scrollTo('top');
    // Return through the same shared bottom action used by the other feature routes.
    await tapNativeNavigationAction('navigation-back');
    await confirmUnsavedLeave();
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    await scrollHomeActionIntoView('open-provider-selection');
    await element(by.id('open-provider-selection')).tap();
    await waitFor(element(by.id('provider-selection-screen')))
      .toBeVisible()
      .withTimeout(30000);
    // The integrated route has one shared Back control outside its scroller.
    await expect(element(by.id('provider-selection-back'))).not.toExist();
    await expect(element(by.id('navigation-back'))).toHaveLabel(
      '이전 화면으로 돌아가기',
    );
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    await scrollHomeActionIntoView('open-appointments');
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
